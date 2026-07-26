#!/usr/bin/env node

import path from "node:path";
import {
  importModule,
  parseArguments,
  readRegistry,
} from "./module-tools.mjs";

const argumentsMap = parseArguments(process.argv.slice(2));
const root = path.resolve(argumentsMap.root ?? process.cwd());
const repository =
  argumentsMap.repository ??
  process.env.GITHUB_REPOSITORY ??
  "AWelook/Surge-Modules-Optimized";
const branch = argumentsMap.branch ?? "main";
const registry = await readRegistry(path.join(root, "registry.json"));

for (const entry of registry) {
  const result = await importModule({
    root,
    url: entry.moduleUrl,
    slug: entry.slug,
    category: entry.category,
    repository,
    branch,
    overwriteOptimized: false,
    publishedModuleFile: entry.moduleFile,
    upstreamModuleFile: entry.upstreamFile,
    conversion: entry.conversion,
    dependencies: entry.dependencies,
  });
  console.log(
    `Synced ${result.category}/${result.slug}: ${result.scriptCount} script(s)`,
  );
}

console.log(`Upstream sync complete: ${registry.length} project(s)`);
