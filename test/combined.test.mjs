import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCombinedModule,
  COMBINED_MODULE_PATH,
  COMBINED_SOURCES,
  extractMitmHostnames,
  parseSections,
} from "../scripts/build-combined-module.mjs";

const sourceTexts = new Map(
  await Promise.all(
    COMBINED_SOURCES.map(async ({ file }) => [
      file,
      await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
    ]),
  ),
);
const combinedText = await readFile(
  new URL(`../${COMBINED_MODULE_PATH}`, import.meta.url),
  "utf8",
);
const registry = JSON.parse(
  await readFile(new URL("../registry.json", import.meta.url), "utf8"),
);
const combinedSections = parseSections(combinedText);

test("combined module is generated exactly from all standalone ad modules", () => {
  assert.equal(combinedText, buildCombinedModule(sourceTexts));
});

test("every combined source is a registered published module", () => {
  const publishedModules = new Set(registry.map(({ moduleFile }) => moduleFile));
  for (const source of COMBINED_SOURCES) {
    assert.ok(
      publishedModules.has(source.file),
      `${source.file} must remain registered for upstream tracking`,
    );
  }
});

test("combined module explicitly excludes Spotify and NetEase Music", () => {
  assert.match(combinedText, /^#!name=去广告合集（不含 Spotify 与网易云）$/mu);
  assert.doesNotMatch(
    combinedText
      .split("\n")
      .filter((line) => !line.startsWith("#!"))
      .join("\n"),
    /spotify|spclient|netease|music\.163|网易云/iu,
  );
});

test("every standalone functional rule remains in the combined module", () => {
  for (const source of COMBINED_SOURCES) {
    const sourceSections = parseSections(sourceTexts.get(source.file));
    for (const [sectionName, content] of sourceSections) {
      if (sectionName === "MITM") {
        continue;
      }
      const combinedContent = combinedSections.get(sectionName);
      assert.ok(combinedContent, `Missing [${sectionName}] for ${source.file}`);
      for (const line of functionalLines(content)) {
        if (sectionName === "Script") {
          const scriptBody = line.slice(line.indexOf("="));
          assert.equal(
            functionalLines(combinedContent).filter((candidate) =>
              candidate.endsWith(scriptBody),
            ).length,
            1,
            `Script body from ${source.file} must occur once`,
          );
        } else {
          assert.equal(
            functionalLines(combinedContent).filter(
              (candidate) => candidate === line,
            ).length,
            1,
            `Rule from ${source.file} must occur once: ${line}`,
          );
        }
      }
    }
  }
});

test("combined Script entries have unique names and unchanged execution options", () => {
  const scriptLines = functionalLines(combinedSections.get("Script"));
  const names = scriptLines.map((line) => line.slice(0, line.indexOf("=")).trim());
  assert.equal(scriptLines.length, 5);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [
    "railway_12306",
    "amap_amdc",
    "amap_response",
    "goofish_amdc",
    "pinduoduo_html",
  ]);
  for (const line of scriptLines) {
    assert.match(
      line,
      /script-path=https:\/\/raw\.githubusercontent\.com\/AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\//u,
    );
  }
});

test("combined MITM list is the deduplicated union of standalone lists", () => {
  const expected = [];
  const seen = new Set();
  for (const source of COMBINED_SOURCES) {
    const sourceMitm = parseSections(sourceTexts.get(source.file)).get("MITM");
    for (const hostname of extractMitmHostnames(sourceMitm ?? "")) {
      if (!seen.has(hostname)) {
        seen.add(hostname);
        expected.push(hostname);
      }
    }
  }
  const actual = extractMitmHostnames(combinedSections.get("MITM"));
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
});

function functionalLines(content = "") {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}
