#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readRegistry } from "./module-tools.mjs";

const root = process.cwd();
const failures = [];
const files = await walk(root);
const publishedScripts = files.filter(
  (filePath) =>
    filePath.endsWith(".js") &&
    (path.dirname(filePath) === root ||
      filePath.startsWith(path.join(root, "scripts") + path.sep)),
);
const publishedModules = files.filter(
  (filePath) =>
    /\.(?:sgmodule|module)$/u.test(filePath) &&
    !filePath.startsWith(path.join(root, "upstream") + path.sep),
);

for (const scriptPath of publishedScripts) {
  const result = spawnSync(process.execPath, ["--check", scriptPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push(
      `${relative(scriptPath)}: JavaScript syntax error\n${result.stderr.trim()}`,
    );
  }
}

const rawPrefixPattern =
  /https:\/\/raw\.githubusercontent\.com\/AWelook\/Surge-Modules-Optimized\/(?:refs\/heads\/)?main\/([^\s,"']+\.js)/giu;
for (const modulePath of publishedModules) {
  const moduleText = await readFile(modulePath, "utf8");
  for (const match of moduleText.matchAll(rawPrefixPattern)) {
    const localPath = path.join(root, ...decodeURI(match[1]).split("/"));
    if (!files.includes(localPath)) {
      failures.push(
        `${relative(modulePath)}: referenced script is missing: ${match[1]}`,
      );
    }
  }
}

const registry = await readRegistry(path.join(root, "registry.json"));
const identities = new Set();
for (const entry of registry) {
  const identity = `${entry.category}/${entry.slug}`;
  if (identities.has(identity)) {
    failures.push(`registry.json: duplicate project ${identity}`);
  }
  identities.add(identity);
  for (const requiredPath of [
    path.join(root, "upstream", entry.category, entry.slug, "module.sgmodule"),
    path.join(root, "modules", entry.category, `${entry.slug}.sgmodule`),
  ]) {
    if (!files.includes(requiredPath)) {
      failures.push(`registry.json: ${identity} is missing ${relative(requiredPath)}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${publishedModules.length} module(s), ` +
      `${publishedScripts.length} script(s), and ${registry.length} registered project(s)`,
  );
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(entryPath)));
    } else if (entry.isFile()) {
      results.push(entryPath);
    }
  }
  return results;
}

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

