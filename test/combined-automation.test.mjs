import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const agentsText = await readFile(
  new URL("../AGENTS.md", import.meta.url),
  "utf8",
);
const importWorkflow = await readFile(
  new URL("../.github/workflows/import-module.yml", import.meta.url),
  "utf8",
);
const syncWorkflow = await readFile(
  new URL("../.github/workflows/sync-upstreams.yml", import.meta.url),
  "utf8",
);

test("upstream optimization instructions require rebuilding combined sources", () => {
  assert.match(
    agentsText,
    /COMBINED_SOURCES[\s\S]+npm run build:combined[\s\S]+same commit/u,
  );
  assert.match(agentsText, /combined-module freshness check/u);
});

test("manual imports rebuild the combined module before validation", () => {
  const buildIndex = importWorkflow.indexOf("npm run build:combined");
  const testIndex = importWorkflow.indexOf("npm test");
  assert.notEqual(buildIndex, -1);
  assert.notEqual(testIndex, -1);
  assert.ok(buildIndex < testIndex);
});

test("upstream issues remind the optimizer to rebuild combined sources", () => {
  assert.match(syncWorkflow, /若属于合集来源则重建合集/u);
});
