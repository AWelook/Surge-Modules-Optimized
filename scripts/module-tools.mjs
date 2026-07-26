import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_REMOTE_BYTES = 8 * 1024 * 1024;
const ALLOWED_REMOTE_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "gist.githubusercontent.com",
]);
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseArguments(argv) {
  const result = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (key === "overwrite-optimized") {
      result.overwriteOptimized = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    result[toCamelCase(key)] = value;
    index += 1;
  }
  return result;
}

export function discoverScriptUrls(moduleText) {
  const urls = [];
  const seen = new Set();
  const patterns = [
    /\bscript-path\s*=\s*(https:\/\/[^,\s"'<>]+)/giu,
    /\bhttps:\/\/[^\s"'<>，,]+\.js(?:[?#][^\s"'<>，,]*)?/giu,
  ];

  for (const pattern of patterns) {
    for (const match of moduleText.matchAll(pattern)) {
      const candidate = (match[1] ?? match[0]).replace(/[)\]}]+$/u, "");
      if (!seen.has(candidate)) {
        validateRemoteUrl(candidate, "script URL");
        seen.add(candidate);
        urls.push(candidate);
      }
    }
  }
  return urls;
}

export async function importModule({
  root,
  url,
  slug,
  category,
  repository,
  branch = "main",
  overwriteOptimized = false,
}) {
  validateName(slug, "slug");
  validateName(category, "category");
  validateRemoteUrl(url, "module URL");
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Invalid repository name: ${repository}`);
  }
  validateName(branch, "branch");

  const moduleText = await fetchText(url, "module");
  const scriptUrls = discoverScriptUrls(moduleText);
  const mappings = createScriptMappings(scriptUrls);
  const upstreamDirectory = path.join(root, "upstream", category, slug);
  const publishedModulePath = path.join(root, "modules", category, `${slug}.sgmodule`);
  const publishedScriptsDirectory = path.join(root, "scripts", category, slug);

  await mkdir(upstreamDirectory, { recursive: true });
  await mkdir(path.dirname(publishedModulePath), { recursive: true });
  await mkdir(publishedScriptsDirectory, { recursive: true });
  await writeIfChanged(path.join(upstreamDirectory, "module.sgmodule"), moduleText);

  const downloadedScripts = [];
  for (const mapping of mappings) {
    const source = await fetchText(mapping.url, `script ${mapping.fileName}`);
    downloadedScripts.push({ ...mapping, source });
    await writeIfChanged(
      path.join(upstreamDirectory, mapping.fileName),
      source,
    );
  }

  const moduleExists = await fileExists(publishedModulePath);
  if (!moduleExists || overwriteOptimized) {
    let publishedModule = moduleText;
    for (const mapping of mappings) {
      const publishedUrl =
        `https://raw.githubusercontent.com/${repository}/refs/heads/${branch}` +
        `/scripts/${category}/${slug}/${mapping.fileName}`;
      publishedModule = publishedModule.split(mapping.url).join(publishedUrl);
    }
    await writeIfChanged(publishedModulePath, publishedModule);
  }

  for (const script of downloadedScripts) {
    const publishedScriptPath = path.join(
      publishedScriptsDirectory,
      script.fileName,
    );
    if (!(await fileExists(publishedScriptPath)) || overwriteOptimized) {
      await writeIfChanged(publishedScriptPath, script.source);
    }
  }

  const registryPath = path.join(root, "registry.json");
  const registry = await readRegistry(registryPath);
  const entry = {
    slug,
    category,
    moduleUrl: url,
    scripts: mappings,
  };
  const existingIndex = registry.findIndex(
    (item) => item.slug === slug && item.category === category,
  );
  if (existingIndex === -1) {
    registry.push(entry);
  } else {
    registry[existingIndex] = entry;
  }
  registry.sort((left, right) =>
    `${left.category}/${left.slug}`.localeCompare(
      `${right.category}/${right.slug}`,
    ),
  );
  await writeIfChanged(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  return {
    category,
    slug,
    scriptCount: mappings.length,
    optimizedFilesOverwritten: overwriteOptimized,
  };
}

export async function readRegistry(registryPath) {
  try {
    const parsed = JSON.parse(await readFile(registryPath, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("registry.json must contain an array");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function validateRemoteUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_REMOTE_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(
      `${label} must use HTTPS on an approved GitHub content host: ${value}`,
    );
  }
  return parsed;
}

async function fetchText(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Surge-Modules-Optimized/1.0" },
      redirect: "follow",
      signal: controller.signal,
    });
    validateRemoteUrl(response.url || url, `${label} redirect target`);
    if (!response.ok) {
      throw new Error(`Unable to download ${label}: HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_REMOTE_BYTES) {
      throw new Error(`${label} exceeds the ${MAX_REMOTE_BYTES}-byte limit`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REMOTE_BYTES) {
      throw new Error(`${label} exceeds the ${MAX_REMOTE_BYTES}-byte limit`);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

function createScriptMappings(urls) {
  const usedNames = new Set();
  return urls.map((url, index) => {
    const parsed = new URL(url);
    let fileName = path.posix.basename(parsed.pathname);
    if (!fileName.toLowerCase().endsWith(".js")) {
      fileName = `script-${index + 1}.js`;
    }
    fileName = fileName.replace(/[^A-Za-z0-9._-]/gu, "_");
    if (!fileName || fileName === ".js") {
      fileName = `script-${index + 1}.js`;
    }
    const extensionIndex = fileName.toLowerCase().lastIndexOf(".js");
    const stem = fileName.slice(0, extensionIndex);
    let uniqueName = fileName;
    let suffix = 2;
    while (usedNames.has(uniqueName.toLowerCase())) {
      uniqueName = `${stem}-${suffix}.js`;
      suffix += 1;
    }
    usedNames.add(uniqueName.toLowerCase());
    return { url, fileName: uniqueName };
  });
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeIfChanged(filePath, content) {
  let current;
  try {
    current = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  if (current === content) {
    return false;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return true;
}

function validateName(value, label) {
  if (!NAME_PATTERN.test(value)) {
    throw new Error(
      `${label} must start with a lowercase letter or digit and contain only lowercase letters, digits, dot, underscore, or hyphen`,
    );
  }
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}
