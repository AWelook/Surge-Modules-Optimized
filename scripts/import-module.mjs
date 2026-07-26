#!/usr/bin/env node

import path from "node:path";
import { importModule, parseArguments } from "./module-tools.mjs";

const argumentsMap = parseArguments(process.argv.slice(2));
const root = path.resolve(argumentsMap.root ?? process.cwd());
const result = await importModule({
  root,
  url: required(argumentsMap.url, "url"),
  slug: required(argumentsMap.slug, "slug"),
  category: argumentsMap.category ?? "ad",
  repository:
    argumentsMap.repository ??
    process.env.GITHUB_REPOSITORY ??
    "AWelook/Surge-Modules-Optimized",
  branch: argumentsMap.branch ?? "main",
  overwriteOptimized: Boolean(argumentsMap.overwriteOptimized),
});

console.log(
  `Imported ${result.category}/${result.slug}: ${result.scriptCount} script(s); ` +
    `overwrite optimized=${result.optimizedFilesOverwritten}`,
);

function required(value, name) {
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

