#!/usr/bin/env node

import path from "node:path";
import { parseArguments } from "./module-tools.mjs";
import { convertRegisteredSnapshots } from "./script-hub-tools.mjs";

const argumentsMap = parseArguments(process.argv.slice(2));
const root = path.resolve(argumentsMap.root ?? process.cwd());
const endpoint =
  argumentsMap.endpoint ??
  process.env.SCRIPT_HUB_ENDPOINT ??
  "http://127.0.0.1:9100";

const converted = await convertRegisteredSnapshots({ root, endpoint });
for (const entry of converted) {
  console.log(`Converted ${entry.category}/${entry.slug}: ${entry.snapshot}`);
}
console.log(`Script Hub conversion complete: ${converted.length} project(s)`);
