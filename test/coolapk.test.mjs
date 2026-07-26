import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const moduleText = await readFile(
  new URL("../modules/ad/coolapk-ads.sgmodule", import.meta.url),
  "utf8",
);
const upstreamText = await readFile(
  new URL("../upstream/ad/coolapk-ads/module.sgmodule", import.meta.url),
  "utf8",
);
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;

const upstreamRules = bodyRules(upstreamText);
const optimizedRules = bodyRules(moduleText);

test("registers the native Surge source without a conversion snapshot", () => {
  assert.match(upstreamText, /^#!name=酷安去广告$/mu);
  assert.match(upstreamText, /^\[Body Rewrite\]$/mu);
  assert.doesNotMatch(upstreamText, /^\[Script\]$/mu);
  assert.equal(
    section(moduleText, "Map Local").trim(),
    section(upstreamText, "Map Local").trim(),
  );
  assert.equal(
    section(moduleText, "MITM").trim(),
    section(upstreamText, "MITM").trim(),
  );
});

test("preserves all six upstream endpoint patterns", () => {
  assert.equal(upstreamRules.length, 6);
  assert.deepEqual(
    optimizedRules.map(({ pattern }) => pattern),
    upstreamRules.map(({ pattern }) => pattern),
  );
});

test("changes only the two redundant traversals and two broken ID filters", () => {
  const changedPatterns = optimizedRules
    .filter(
      ({ pattern, filter }) =>
        filter !== ruleFor(upstreamRules, pattern).filter,
    )
    .map(({ pattern }) => pattern);
  assert.deepEqual(changedPatterns, [
    String.raw`^https:\/\/api\.coolapk\.com\/v6\/feed\/replyList`,
    String.raw`^https:\/\/api\.coolapk\.com\/v6\/main\/dataList`,
    String.raw`^https:\/\/api\.coolapk\.com\/v6\/main\/indexV8`,
    String.raw`^https:\/\/api\.coolapk\.com\/v6\/main\/init`,
  ]);
});

test(
  "removing redundant length checks is behavior-equivalent",
  { skip: !jqAvailable },
  () => {
    const fixtures = [
      {},
      { data: null },
      { data: [] },
      { data: [{ id: 1 }, { name: "ad" }, null] },
      { data: {} },
      { data: "text" },
      { data: false },
      { data: true },
      { data: 1 },
      {
        data: [
          { entityTemplate: "sponsorCard" },
          { title: "精选配件" },
          { id: 1 },
        ],
      },
    ];
    for (const pattern of [
      String.raw`^https:\/\/api\.coolapk\.com\/v6\/feed\/replyList`,
      String.raw`^https:\/\/api\.coolapk\.com\/v6\/main\/dataList`,
    ]) {
      for (const fixture of fixtures) {
        assert.deepEqual(
          runJq(ruleFor(optimizedRules, pattern).filter, fixture),
          runJq(ruleFor(upstreamRules, pattern).filter, fixture),
        );
      }
    }
  },
);

test(
  "indexV8 filter removes the intended cards without a jq context error",
  { skip: !jqAvailable },
  () => {
    const pattern =
      String.raw`^https:\/\/api\.coolapk\.com\/v6\/main\/indexV8`;
    const input = {
      data: [
        { id: 1, entityTemplate: "sponsorCard", title: "广告" },
        { id: 2, entityId: 8639, title: "普通" },
        { id: 3, entityId: 29349, title: "普通" },
        { id: 4, entityId: 33006, title: "普通" },
        { id: 5, entityId: 32557, title: "普通" },
        { id: 6, entityId: 1, title: "值得买商品" },
        { id: 7, entityId: 2, title: "领红包" },
        { id: 8, entityId: 3, title: "正常内容" },
      ],
    };

    const upstreamResult = spawnJq(
      ruleFor(upstreamRules, pattern).filter,
      input,
    );
    assert.notEqual(upstreamResult.status, 0);
    assert.match(upstreamResult.stderr, /Cannot index array with string/u);

    assert.deepEqual(
      runJq(ruleFor(optimizedRules, pattern).filter, input).data,
      [{ id: 8, entityId: 3, title: "正常内容" }],
    );
  },
);

test(
  "main init filter keeps normal entries and removes only intended IDs",
  { skip: !jqAvailable },
  () => {
    const pattern =
      String.raw`^https:\/\/api\.coolapk\.com\/v6\/main\/init`;
    const input = {
      data: [
        { entityId: 944, title: "移除 1" },
        { entityId: 945, title: "移除 2" },
        { entityId: 6390, title: "移除 3" },
        {
          entityId: 20131,
          entities: [{ title: "酷品" }, { title: "正常入口" }],
        },
        { entityId: 1, title: "正常内容" },
      ],
    };

    assert.deepEqual(
      runJq(ruleFor(upstreamRules, pattern).filter, input).data,
      [],
    );
    assert.deepEqual(
      runJq(ruleFor(optimizedRules, pattern).filter, input).data,
      [
        { entityId: 20131, entities: [{ title: "正常入口" }] },
        { entityId: 1, title: "正常内容" },
      ],
    );
  },
);

test(
  "the remaining ad-removal effects are preserved",
  { skip: !jqAvailable },
  () => {
    const detailPattern =
      String.raw`^https:\/\/api\.coolapk\.com\/v6\/feed\/detail\?`;
    const detail = runJq(ruleFor(optimizedRules, detailPattern).filter, {
      data: {
        hotReplyRows: [{ id: 1 }, { text: "ad" }],
        topReplyRows: [{ id: 2 }, {}],
        detailSponsorCard: { id: 3 },
        include_goods: [4],
        include_goods_ids: [5],
        keep: true,
      },
    });
    assert.deepEqual(detail.data, {
      hotReplyRows: [{ id: 1 }],
      topReplyRows: [{ id: 2 }],
      detailSponsorCard: [],
      include_goods: [],
      include_goods_ids: [],
      keep: true,
    });

    const pagePattern =
      String.raw`^https:\/\/api\.coolapk\.com\/v6\/page\/dataList`;
    const page = runJq(ruleFor(optimizedRules, pagePattern).filter, {
      data: [
        { id: 1, title: "酷安热搜" },
        { id: 2, entityTemplate: "imageScaleCard" },
        { id: 3, entityTemplate: "sponsorCard" },
        { id: 4, title: "正常内容" },
      ],
    });
    assert.deepEqual(page.data, [{ id: 4, title: "正常内容" }]);
  },
);

function section(text, name) {
  const marker = `[${name}]`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const contentStart = start + marker.length;
  const next = text.indexOf("\n[", contentStart);
  return text.slice(contentStart, next === -1 ? text.length : next);
}

function bodyRules(text) {
  return section(text, "Body Rewrite")
    .split("\n")
    .filter((line) => line.startsWith("http-response-jq "))
    .map((line) => {
      const match = line.match(/^http-response-jq\s+(.+?)\s+'(.+)'$/u);
      assert.ok(match, `Unable to parse Body Rewrite rule: ${line}`);
      return { pattern: match[1], filter: match[2] };
    });
}

function ruleFor(rules, pattern) {
  const matches = rules.filter((rule) => rule.pattern === pattern);
  assert.equal(matches.length, 1, `Expected one rule for ${pattern}`);
  return matches[0];
}

function spawnJq(filter, input) {
  return spawnSync("jq", ["-c", filter], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

function runJq(filter, input) {
  const result = spawnJq(filter, input);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
