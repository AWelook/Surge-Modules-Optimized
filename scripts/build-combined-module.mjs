#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const COMBINED_MODULE_PATH = "modules/ad/ad-combined.sgmodule";

export const COMBINED_SOURCES = [
  {
    id: "railway",
    label: "12306",
    file: "modules/ad/12306.sgmodule",
    scriptAliases: { "12306": "railway_12306" },
  },
  {
    id: "amap",
    label: "高德地图",
    file: "modules/ad/amap-ads.sgmodule",
    scriptAliases: { amap: "amap_response" },
    excludedScriptNames: ["amdc"],
  },
  {
    id: "coolapk",
    label: "酷安",
    file: "modules/ad/coolapk-ads.sgmodule",
  },
  {
    id: "didi",
    label: "滴滴出行",
    file: "modules/ad/didichuxing.sgmodule",
  },
  {
    id: "goofish",
    label: "闲鱼",
    file: "modules/ad/goofish-ads.sgmodule",
    excludedScriptNames: ["amdc"],
  },
  {
    id: "pinduoduo",
    label: "拼多多",
    file: "modules/ad/pinduoduo-ads.sgmodule",
    scriptAliases: {
      "移除扫码取件页面商品推荐及弹窗": "pinduoduo_html",
    },
  },
  {
    id: "reddit",
    label: "Reddit",
    file: "modules/ad/reddit-ads.sgmodule",
    includeArgumentHeaders: true,
  },
  {
    id: "weibo-intl",
    label: "微博轻享版",
    file: "modules/ad/weibo-intl-ads.sgmodule",
  },
  {
    id: "xiaohongshu",
    label: "小红书",
    file: "modules/ad/xiaohongshu-ads.sgmodule",
    scriptAliases: { xiaohongshu_response: "xiaohongshu_response" },
  },
];

const SECTION_ORDER = [
  "General",
  "Rule",
  "URL Rewrite",
  "Body Rewrite",
  "Header Rewrite",
  "Map Local",
  "Script",
];

const BASE_HEADER = `#!name=去广告合集（不含 Spotify 与网易云）
#!desc=合并 12306、高德地图、酷安、滴滴出行、闲鱼、拼多多、Reddit、微博轻享版和小红书去广告；请勿与对应单独版同时启用
#!author=原规则作者与 AWelook
#!homepage=https://github.com/AWelook/Surge-Modules-Optimized`;

const SHARED_AMDC_SCRIPT_BLOCK = String.raw`# > ===== 高德地图 / 闲鱼共享 =====
# > 合并重叠的 AMDC 处理，避免同一响应执行两个脚本
combined_amdc = type=http-response, pattern="^http:\/\/(?:amdc\.m\.taobao\.com|[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){1,4}(?::\d+)?\/amdc\/mobileDispatch)", script-path=https://raw.githubusercontent.com/AWelook/Surge-Modules-Optimized/refs/heads/main/scripts/ad/goofish-ads/amdc.js, requires-body=true, max-size=-1, timeout=60`;

export function buildCombinedModule(sourceTexts) {
  const parsedSources = COMBINED_SOURCES.map((source) => {
    const text = sourceTexts.get(source.file);
    if (typeof text !== "string") {
      throw new Error(`Missing combined-module source: ${source.file}`);
    }
    return { ...source, text, sections: parseSections(text) };
  });

  const argumentHeaders = parsedSources.flatMap((source) =>
    source.includeArgumentHeaders
      ? extractArgumentHeaders(source.text, source.file)
      : [],
  );
  const header = [BASE_HEADER, ...argumentHeaders].join("\n");
  const outputSections = [];
  for (const sectionName of SECTION_ORDER) {
    const blocks = [];
    for (const source of parsedSources) {
      const content = source.sections.get(sectionName);
      if (!content) {
        continue;
      }
      const transformedContent =
        sectionName === "Script"
          ? namespaceScriptNames(content, source)
          : content;
      if (!transformedContent) {
        continue;
      }
      blocks.push(
        `# > ===== ${source.label} =====\n` +
          transformedContent,
      );
    }
    if (sectionName === "Script") {
      blocks.push(SHARED_AMDC_SCRIPT_BLOCK);
    }
    if (blocks.length) {
      outputSections.push(`[${sectionName}]\n${blocks.join("\n\n")}`);
    }
  }

  const hostnames = [];
  const seenHostnames = new Set();
  for (const source of parsedSources) {
    const mitm = source.sections.get("MITM");
    if (!mitm) {
      continue;
    }
    for (const hostname of extractMitmHostnames(mitm)) {
      if (!seenHostnames.has(hostname)) {
        seenHostnames.add(hostname);
        hostnames.push(hostname);
      }
    }
  }
  if (hostnames.length) {
    outputSections.push(`[MITM]\nhostname = %APPEND% ${hostnames.join(", ")}`);
  }

  return `${header}\n\n${outputSections.join("\n\n")}\n`;
}

export function parseSections(text) {
  const sections = new Map();
  let currentName;
  let currentLines = [];

  const saveCurrent = () => {
    if (!currentName) {
      return;
    }
    const content = trimBlankLines(currentLines).join("\n");
    if (content) {
      sections.set(currentName, content);
    }
  };

  for (const line of text.replace(/\r\n?/gu, "\n").split("\n")) {
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*$/u);
    if (sectionMatch) {
      saveCurrent();
      currentName = sectionMatch[1];
      currentLines = [];
    } else if (currentName) {
      currentLines.push(line);
    }
  }
  saveCurrent();
  return sections;
}

export function extractMitmHostnames(content) {
  const hostnames = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*hostname\s*=\s*%APPEND%\s*(.+?)\s*$/iu);
    if (!match) {
      if (line.trim() && !line.trimStart().startsWith("#")) {
        throw new Error(`Unsupported MITM line in combined source: ${line}`);
      }
      continue;
    }
    hostnames.push(
      ...match[1]
        .split(",")
        .map((hostname) => hostname.trim())
        .filter(Boolean),
    );
  }
  return hostnames;
}

function extractArgumentHeaders(text, sourceFile) {
  const headers = text
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line.startsWith("#!arguments=") ||
        line.startsWith("#!arguments-desc="),
    );
  if (
    headers.filter((line) => line.startsWith("#!arguments=")).length !== 1 ||
    headers.filter((line) => line.startsWith("#!arguments-desc=")).length !== 1
  ) {
    throw new Error(
      `${sourceFile} must contain one #!arguments and one #!arguments-desc header`,
    );
  }
  return headers;
}

function namespaceScriptNames(content, source) {
  return content
    .split(/\n\s*\n/u)
    .map((block) => {
      const lines = block.split("\n");
      const scriptLineIndex = lines.findIndex(
        (line) => line.trim() && !line.trimStart().startsWith("#"),
      );
      if (scriptLineIndex === -1) {
        return block;
      }
      const line = lines[scriptLineIndex];
      const match = line.match(/^(\s*)([^=]+?)(\s*=\s*)(.+)$/u);
      if (!match) {
        throw new Error(`Unsupported Script line in ${source.file}: ${line}`);
      }
      const originalName = match[2].trim();
      if (source.excludedScriptNames?.includes(originalName)) {
        return "";
      }
      const fallbackName =
        `${source.id}_${originalName}`.replace(/[^A-Za-z0-9_-]/gu, "_");
      const combinedName =
        source.scriptAliases?.[originalName] ?? fallbackName;
      lines[scriptLineIndex] =
        `${match[1]}${combinedName}${match[3]}${match[4]}`;
      return lines.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) {
    start += 1;
  }
  while (end > start && !lines[end - 1].trim()) {
    end -= 1;
  }
  return lines.slice(start, end);
}

async function run() {
  const root = process.cwd();
  const sourceTexts = new Map(
    await Promise.all(
      COMBINED_SOURCES.map(async ({ file }) => [
        file,
        await readFile(path.join(root, file), "utf8"),
      ]),
    ),
  );
  const generated = buildCombinedModule(sourceTexts);
  const outputPath = path.join(root, COMBINED_MODULE_PATH);

  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        return "";
      }
      throw error;
    });
    if (current !== generated) {
      throw new Error(
        `${COMBINED_MODULE_PATH} is stale; run npm run build:combined`,
      );
    }
    console.log(`Combined module is current: ${COMBINED_MODULE_PATH}`);
    return;
  }

  await writeFile(outputPath, generated, "utf8");
  console.log(`Generated ${COMBINED_MODULE_PATH}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await run();
}
