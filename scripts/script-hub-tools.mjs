import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readRegistry } from "./module-tools.mjs";

const MAX_CONVERTED_BYTES = 8 * 1024 * 1024;
const VALID_SOURCE_TYPES = new Set([
  "loon-plugin",
  "qx-rewrite",
  "surge-module",
]);
const VALID_TARGET_TYPES = new Set(["surge-module"]);

export async function convertRegisteredSnapshots({
  root,
  endpoint,
  fetchImpl = globalThis.fetch,
}) {
  const registry = await readRegistry(path.join(root, "registry.json"));
  const converted = [];

  for (const entry of registry) {
    if (!entry.conversion?.automation) {
      continue;
    }
    const conversion = entry.conversion;
    const sourcePath = resolveManagedPath(root, entry.upstreamFile);
    const snapshotPath = resolveManagedPath(root, conversion.snapshot);
    const source = await readFile(sourcePath, "utf8");
    const output = await convertWithScriptHub({
      endpoint,
      source,
      fileName: `${entry.slug}.sgmodule`,
      sourceType: conversion.sourceType,
      targetType: conversion.targetType,
      jqEnabled: conversion.automation.jqEnabled === true,
      fetchImpl,
    });

    await writeIfChanged(snapshotPath, output);
    converted.push({
      category: entry.category,
      slug: entry.slug,
      snapshot: conversion.snapshot,
    });
  }

  return converted;
}

export async function convertWithScriptHub({
  endpoint,
  source,
  fileName,
  sourceType,
  targetType,
  jqEnabled = false,
  fetchImpl = globalThis.fetch,
}) {
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    throw new Error(`Unsupported Script Hub source type: ${sourceType}`);
  }
  if (!VALID_TARGET_TYPES.has(targetType)) {
    throw new Error(`Unsupported Script Hub target type: ${targetType}`);
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(fileName)) {
    throw new Error(`Invalid converted file name: ${fileName}`);
  }

  const serviceUrl = new URL(endpoint);
  if (!["http:", "https:"].includes(serviceUrl.protocol)) {
    throw new Error(`Invalid Script Hub endpoint: ${endpoint}`);
  }
  const basePath = serviceUrl.pathname.replace(/\/+$/u, "");
  serviceUrl.pathname =
    `${basePath}/file/_start_/http://local.text/_end_/${fileName}`;
  serviceUrl.search =
    `?type=${encodeURIComponent(sourceType)}` +
    `&target=${encodeURIComponent(targetType)}` +
    `&jqEnabled=${jqEnabled ? "true" : "false"}` +
    `&localtext=${encodeURIComponent(source)}`;

  const response = await fetchImpl(serviceUrl, {
    headers: { "user-agent": "Surge-Modules-Optimized/1.0" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Script Hub conversion failed: HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CONVERTED_BYTES) {
    throw new Error(
      `Script Hub output exceeds the ${MAX_CONVERTED_BYTES}-byte limit`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CONVERTED_BYTES) {
    throw new Error(
      `Script Hub output exceeds the ${MAX_CONVERTED_BYTES}-byte limit`,
    );
  }
  const output = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  validateConvertedModule(output);
  return output;
}

function validateConvertedModule(output) {
  if (!/^#!name=.+$/mu.test(output)) {
    throw new Error("Script Hub output is missing #!name");
  }
  if (!/^\[(?:Rule|URL Rewrite|Body Rewrite|Map Local|Script|MITM)\]$/mu.test(
    output,
  )) {
    throw new Error("Script Hub output has no recognized Surge section");
  }
  if (/^#!error=/mu.test(output)) {
    throw new Error("Script Hub reported a conversion error");
  }
}

function resolveManagedPath(root, configuredPath) {
  if (!configuredPath) {
    throw new Error("Converted entries require a managed file path");
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(root, configuredPath);
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Managed path must stay inside the repository: ${configuredPath}`);
  }
  return resolvedPath;
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
