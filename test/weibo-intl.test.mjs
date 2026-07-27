import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const moduleText = await readFile(
  new URL("../modules/ad/weibo-intl-ads.sgmodule", import.meta.url),
  "utf8",
);
const upstreamText = await readFile(
  new URL("../upstream/ad/weibo-intl-ads/module.sgmodule", import.meta.url),
  "utf8",
);
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;
const upstreamRules = bodyRules(upstreamText);
const optimizedRules = bodyRules(moduleText);
const userCenterPattern =
  String.raw`^https?:\/\/weibointl\.api\.weibo\.cn\/portal\.php\?a=user_center&`;

test("registers the native Surge source without remote scripts", () => {
  assert.match(upstreamText, /^#!name=微博轻享版去广告$/mu);
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

test("preserves all upstream endpoint patterns", () => {
  assert.equal(upstreamRules.length, 5);
  assert.deepEqual(
    optimizedRules.map(({ pattern }) => pattern),
    upstreamRules.map(({ pattern }) => pattern),
  );
  assert.equal(mapLocalLines(moduleText).length, 3);
});

test("changes only the user-center double traversal", () => {
  const changed = optimizedRules
    .filter(
      ({ pattern, filter }) =>
        filter !== ruleFor(upstreamRules, pattern).filter,
    )
    .map(({ pattern }) => pattern);
  assert.deepEqual(changed, [userCenterPattern]);
  assert.match(
    ruleFor(optimizedRules, userCenterPattern).filter,
    /\.data\.cards \|= map\(\(\.items \|= map\(/u,
  );
  assert.doesNotMatch(
    ruleFor(optimizedRules, userCenterPattern).filter,
    /\.data\.cards\[\]/u,
  );
});

test(
  "single-pass user-center filtering is output-equivalent",
  { skip: !jqAvailable },
  () => {
    const fixtures = [
      {},
      { data: null },
      { data: {} },
      { data: { cards: null } },
      { data: { cards: [] } },
      {
        data: {
          cards: [
            { id: 1, items: [] },
            { id: 2, items: [{ type: "personal_vip" }] },
            {
              id: 3,
              items: [
                { type: "personal_vip", title: "会员" },
                { type: "normal", title: "保留" },
              ],
            },
          ],
        },
      },
      {
        data: {
          cards: Array.from({ length: 120 }, (_, index) => ({
            id: index,
            items: Array.from({ length: index % 7 }, (_, itemIndex) => ({
              type:
                (index + itemIndex) % 4 === 0
                  ? "personal_vip"
                  : `normal_${itemIndex}`,
            })),
          })),
        },
      },
    ];
    const upstreamFilter = ruleFor(
      upstreamRules,
      userCenterPattern,
    ).filter;
    const optimizedFilter = ruleFor(
      optimizedRules,
      userCenterPattern,
    ).filter;

    for (const fixture of fixtures) {
      const expected = spawnJq(upstreamFilter, fixture);
      const actual = spawnJq(optimizedFilter, fixture);
      assert.equal(expected.status, 0, expected.stderr);
      assert.equal(actual.status, 0, actual.stderr);
      assert.equal(actual.stdout, expected.stdout);
    }
  },
);

test(
  "single-pass rule preserves the upstream malformed-card failure",
  { skip: !jqAvailable },
  () => {
    const input = { data: { cards: [{}] } };
    const expected = spawnJq(
      ruleFor(upstreamRules, userCenterPattern).filter,
      input,
    );
    const actual = spawnJq(
      ruleFor(optimizedRules, userCenterPattern).filter,
      input,
    );
    assert.notEqual(expected.status, 0);
    assert.equal(actual.status, expected.status);
    assert.equal(actual.stdout, expected.stdout);
    assert.match(expected.stderr, /Cannot iterate over null/u);
    assert.match(actual.stderr, /Cannot iterate over null/u);
  },
);

test(
  "the remaining four jq effects are unchanged",
  { skip: !jqAvailable },
  () => {
    const timelinePattern =
      String.raw`^https?:\/\/api\.weibo\.cn\/2\/statuses\/unread_hot_timeline$`;
    assert.deepEqual(
      runJq(ruleFor(optimizedRules, timelinePattern).filter, {
        ad: { id: 1 },
        advertises: [2],
        trends: [3],
        statuses: [
          { id: 1, promotion: { type: "ad" } },
          { id: 2, mblogtypename: "广告" },
          { id: 3, mblogtypename: "廣告" },
          { id: 4, mblogtypename: "热推" },
          { id: 5, mblogtypename: "熱推" },
          { id: 6, text: "正常微博" },
        ],
      }),
      { statuses: [{ id: 6, text: "正常微博" }] },
    );

    const coopenPattern =
      String.raw`^https?:\/\/weibointl\.api\.weibo\.cn\/portal\.php\?a=get_coopen_ads&`;
    const coopen = runJq(ruleFor(optimizedRules, coopenPattern).filter, {
      data: { keep: true, ad_list: [{ id: 1 }], display_ad: 1 },
    });
    assert.equal(coopen.data.keep, true);
    assert.deepEqual(coopen.data.ad_list, []);
    assert.deepEqual(coopen.data.pic_ad, []);
    assert.equal(coopen.data.display_ad, 0);
    assert.equal(coopen.data.ad_duration, 604800);

    const trendsPattern =
      String.raw`^https?:\/\/weibointl\.api\.weibo\.cn\/portal\.php\?a=trends&`;
    assert.deepEqual(
      runJq(ruleFor(optimizedRules, trendsPattern).filter, {
        data: { order: ["ad", "search_topic"] },
      }),
      { data: { order: ["search_topic"] } },
    );

    const searchPattern =
      String.raw`^https?:\/\/weibointl\.api\.weibo\.cn\/portal\.php\?a=search_topic&`;
    assert.deepEqual(
      runJq(ruleFor(optimizedRules, searchPattern).filter, {
        data: {
          search_topic: {
            cards: [
              { type: "searchtop", title: "推广" },
              { type: "normal", title: "保留" },
            ],
          },
        },
      }),
      {
        data: {
          search_topic: {
            cards: [{ type: "normal", title: "保留" }],
          },
        },
      },
    );
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
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("http-response-jq "))
    .map((line) => {
      const match = line.match(/^http-response-jq\s+(.+?)\s+'(.+)'$/u);
      assert.ok(match, `Unable to parse Body Rewrite rule: ${line}`);
      return { pattern: match[1], filter: match[2] };
    });
}

function mapLocalLines(text) {
  return section(text, "Map Local")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("^"));
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
