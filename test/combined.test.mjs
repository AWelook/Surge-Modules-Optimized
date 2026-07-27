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

test("combined module preserves Reddit parameter controls", () => {
  const redditText = sourceTexts.get("modules/ad/reddit-ads.sgmodule");
  for (const prefix of ["#!arguments=", "#!arguments-desc="]) {
    const expected = redditText
      .split(/\r?\n/u)
      .find((line) => line.startsWith(prefix));
    assert.ok(expected, `Reddit source is missing ${prefix}`);
    assert.equal(
      combinedText
        .split(/\r?\n/u)
        .filter((line) => line.startsWith(prefix)).length,
      1,
    );
    assert.match(combinedText, new RegExp(`^${escapeRegex(expected)}$`, "mu"));
  }
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
  assert.equal(scriptLines.length, 5);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [
    "railway_12306",
    "amap_response",
    "pinduoduo_html",
    "xiaohongshu_response",
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

  const headerRewriteLines = functionalLines(
    combinedSections.get("Header Rewrite"),
  );
  assert.equal(
    new Set(headerRewriteLines).size,
    headerRewriteLines.length,
    "[Header Rewrite] contains an exact duplicate handler",
  );
});

test("Reddit handlers do not collide with another combined source", () => {
  const redditUrl = "https://gql.reddit.com/";
  const bodyMatches = functionalLines(
    combinedSections.get("Body Rewrite"),
  ).filter((line) => {
    const pattern = line.split(/\s+/u)[1];
    return new RegExp(pattern, "u").test(redditUrl);
  });
  assert.equal(bodyMatches.length, 1);
  assert.match(bodyMatches[0], /^http-response-jq /u);

  const headerMatches = functionalLines(
    combinedSections.get("Header Rewrite"),
  ).filter((line) => {
    const pattern = line.split(/\s+/u)[1];
    return new RegExp(pattern, "u").test(redditUrl);
  });
  assert.equal(headerMatches.length, 2);
  assert.match(headerMatches[0], / header-del x-reddit-translations$/u);
  assert.match(
    headerMatches[1],
    / header-add x-reddit-translations "\{\{\{TRANSLATION_VALUE\}\}\}"$/u,
  );
});

test("Weibo International handlers do not collide with another combined source", () => {
  const bodyUrls = [
    "https://api.weibo.cn/2/statuses/unread_hot_timeline",
    "https://weibointl.api.weibo.cn/portal.php?a=get_coopen_ads&",
    "https://weibointl.api.weibo.cn/portal.php?a=trends&",
    "https://weibointl.api.weibo.cn/portal.php?a=search_topic&",
    "https://weibointl.api.weibo.cn/portal.php?a=user_center&",
  ];
  const bodyPatterns = functionalLines(
    combinedSections.get("Body Rewrite"),
  ).map((line) => line.split(/\s+/u)[1]);
  for (const url of bodyUrls) {
    assert.equal(
      bodyPatterns.filter((pattern) => new RegExp(pattern, "u").test(url))
        .length,
      1,
      `${url} must match exactly one combined Body Rewrite`,
    );
  }

  const mapUrls = [
    "https://api.weibo.cn/2/ad/weibointl?x=1",
    "https://weibointl.api.weibo.cn/portal.php?a=get_searching_info&x=1",
    "https://weibointl.api.weibo.cn/portal.php?ct=feed&a=search_topic&x=1",
  ];
  const mapPatterns = functionalLines(
    combinedSections.get("Map Local"),
  ).map((line) => line.split(/\s+/u)[0]);
  for (const url of mapUrls) {
    assert.equal(
      mapPatterns.filter((pattern) => new RegExp(pattern, "u").test(url))
        .length,
      1,
      `${url} must match exactly one combined Map Local`,
    );
  }
});

test("Xiaohongshu handlers do not collide with another combined source", () => {
  const bodyUrls = [
    "https://edith.xiaohongshu.com/api/sns/v1/search/banner_list",
    "https://edith.xiaohongshu.com/api/sns/v1/search/hot_list",
    "https://edith.xiaohongshu.com/api/sns/v4/search/hint",
    "https://edith.xiaohongshu.com/api/sns/v4/search/trending?x=1",
  ];
  const bodyPatterns = functionalLines(
    combinedSections.get("Body Rewrite"),
  ).map((line) => line.split(/\s+/u)[1]);
  for (const url of bodyUrls) {
    assert.equal(
      bodyPatterns.filter((pattern) => new RegExp(pattern, "u").test(url))
        .length,
      1,
      `${url} must match exactly one combined Body Rewrite`,
    );
  }

  const scriptUrl =
    "https://rec.xiaohongshu.com/api/sns/v6/homefeed?x=1";
  assert.equal(
    scriptEntries(combinedSections.get("Script")).filter(({ pattern }) =>
      new RegExp(pattern, "u").test(scriptUrl),
    ).length,
    1,
  );

  const mapUrl =
    "https://www.xiaohongshu.com/api/marketing/box/trigger?x=1";
  assert.equal(
    functionalLines(combinedSections.get("Map Local")).filter((line) =>
      new RegExp(line.split(/\s+/u)[0], "u").test(mapUrl),
    ).length,
    1,
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
