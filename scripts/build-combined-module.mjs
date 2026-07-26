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
  },
  {
    id: "pinduoduo",
    label: "拼多多",
    file: "modules/ad/pinduoduo-ads.sgmodule",
    scriptAliases: {
      "移除扫码取件页面商品推荐及弹窗": "pinduoduo_html",
    },
  },
];

const SECTION_ORDER = [
  "Rule",
  "URL Rewrite",
  "Body Rewrite",
  "Map Local",
  "Script",
];

const HEADER = `#!name=去广告合集（不含 Spotify 与网易云）
#!desc=合并 12306、高德地图、酷安、滴滴出行、闲鱼和拼多多去广告；请勿与对应单独版同时启用
#!author=原规则作者与 AWelook
#!homepage=https://github.com/AWelook/Surge-Modules-Optimized
`;

export function buildCombinedModule(sourceTexts) {
  const parsedSources = COMBINED_SOURCES.map((source) => {
    const text = sourceTexts.get(source.file);
    if (typeof text !== "string") {
      throw new Error(`Missing combined-module source: ${source.file}`);
    }
    return { ...source, sections: parseSections(text) };
  });

  const outputSections = [];
  for (const sectionName of SECTION_ORDER) {
    const blocks = [];
    for (const source of parsedSources) {
      const content = source.sections.get(sectionName);
      if (!content) {
        continue;
      }
      blocks.push(
        `# > ===== ${source.label} =====\n` +
          (sectionName === "Script"
            ? namespaceScriptNames(content, source)
            : content),
      );
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

  return `${HEADER}\n${outputSections.join("\n\n")}\n`;
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

function namespaceScriptNames(content, source) {
  return content
    .split("\n")
    .map((line) => {
      if (!line.trim() || line.trimStart().startsWith("#")) {
        return line;
      }
      const match = line.match(/^(\s*)([^=]+?)(\s*=\s*)(.+)$/u);
      if (!match) {
        throw new Error(`Unsupported Script line in ${source.file}: ${line}`);
      }
      const originalName = match[2].trim();
      const fallbackName =
        `${source.id}_${originalName}`.replace(/[^A-Za-z0-9_-]/gu, "_");
      const combinedName =
        source.scriptAliases?.[originalName] ?? fallbackName;
      return `${match[1]}${combinedName}${match[3]}${match[4]}`;
    })
    .join("\n");
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
