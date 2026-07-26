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
          const scriptName = line.slice(0, line.indexOf("=")).trim();
          if (source.excludedScriptNames?.includes(scriptName)) {
            continue;
          }
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
  assert.equal(scriptLines.length, 4);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [
    "railway_12306",
    "amap_response",
    "pinduoduo_html",
    "combined_amdc",
  ]);
  for (const line of scriptLines) {
    assert.match(
      line,
      /script-path=https:\/\/raw\.githubusercontent\.com\/AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\//u,
    );
  }
});

test("overlapping Amap and Goofish AMDC handlers are merged without losing coverage", () => {
  const amapEntries = scriptEntries(
    parseSections(sourceTexts.get("modules/ad/amap-ads.sgmodule")).get("Script"),
  );
  const goofishEntries = scriptEntries(
    parseSections(sourceTexts.get("modules/ad/goofish-ads.sgmodule")).get("Script"),
  );
  const combinedEntries = scriptEntries(combinedSections.get("Script"));
  const overlappingUrl =
    "http://amdc.m.taobao.com/amdc/mobileDispatch";

  assert.equal(countMatchingEntries(amapEntries, overlappingUrl), 1);
  assert.equal(countMatchingEntries(goofishEntries, overlappingUrl), 1);
  assert.equal(countMatchingEntries(combinedEntries, overlappingUrl), 1);

  const shared = combinedEntries.find(({ name }) => name === "combined_amdc");
  assert.ok(shared, "The shared AMDC handler must be present");
  assert.match(
    shared.line,
    /script-path=https:\/\/raw\.githubusercontent\.com\/AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\/goofish-ads\/amdc\.js/u,
  );
  assert.match(shared.line, /requires-body=true/u);
  assert.match(shared.line, /max-size=-1/u);
  assert.match(shared.line, /timeout=60/u);

  assert.equal(
    countMatchingEntries(
      combinedEntries,
      "http://amdc.m.taobao.com/other",
    ),
    1,
    "Amap's broader host coverage must remain",
  );
  assert.equal(
    countMatchingEntries(
      combinedEntries,
      "http://foo.example.com/amdc/mobileDispatch",
    ),
    1,
    "Goofish's mobileDispatch coverage must remain",
  );
});

test("combined rewrite and script handlers have no exact duplicate patterns", () => {
  for (const sectionName of [
    "URL Rewrite",
    "Body Rewrite",
    "Map Local",
  ]) {
    const patterns = functionalLines(combinedSections.get(sectionName)).map(
      (line) => {
        const fields = line.split(/\s+/u);
        return sectionName === "Body Rewrite" ? fields[1] : fields[0];
      },
    );
    assert.equal(
      new Set(patterns).size,
      patterns.length,
      `[${sectionName}] contains an exact duplicate pattern`,
    );
  }

  const scriptPatterns = scriptEntries(
    combinedSections.get("Script"),
  ).map(({ pattern }) => pattern);
  assert.equal(
    new Set(scriptPatterns).size,
    scriptPatterns.length,
    "[Script] contains an exact duplicate pattern",
  );
});

test("combined simple rules do not assign conflicting policies", () => {
  const policies = new Map();
  for (const line of functionalLines(combinedSections.get("Rule"))) {
    const fields = line.split(",").map((field) => field.trim());
    if (
      !["DOMAIN", "DOMAIN-SUFFIX", "IP-CIDR", "IP-CIDR6"].includes(fields[0])
    ) {
      continue;
    }
    const key = `${fields[0]},${fields[1]}`;
    const previousPolicy = policies.get(key);
    assert.ok(
      previousPolicy === undefined || previousPolicy === fields[2],
      `${key} uses both ${previousPolicy} and ${fields[2]}`,
    );
    assert.equal(
      previousPolicy,
      undefined,
      `${key} is duplicated in the combined module`,
    );
    policies.set(key, fields[2]);
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

function scriptEntries(content = "") {
  return functionalLines(content).map((line) => {
    const separatorIndex = line.indexOf("=");
    assert.notEqual(separatorIndex, -1, `Invalid Script entry: ${line}`);
    const name = line.slice(0, separatorIndex).trim();
    const patternMatch = line.match(
      /(?:^|,\s*)pattern=(?:"([^"]+)"|([^,]+)),\s*script-path=/u,
    );
    assert.ok(patternMatch, `Script entry has no supported pattern: ${line}`);
    return {
      name,
      line,
      pattern: patternMatch[1] ?? patternMatch[2].trim(),
    };
  });
}

function countMatchingEntries(entries, url) {
  return entries.filter(({ pattern }) => new RegExp(pattern, "u").test(url))
    .length;
}
