import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const moduleText = await readFile(
  new URL("../modules/ad/reddit-ads.sgmodule", import.meta.url),
  "utf8",
);
const upstreamText = await readFile(
  new URL("../upstream/ad/reddit-ads/module.sgmodule", import.meta.url),
  "utf8",
);
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;
const upstreamRule = bodyRule(upstreamText);
const optimizedRule = bodyRule(moduleText);

test("registers the native Surge source and preserves all parameters", () => {
  assert.equal(
    header(moduleText, "#!arguments="),
    header(upstreamText, "#!arguments="),
  );
  assert.equal(
    header(moduleText, "#!arguments-desc="),
    header(upstreamText, "#!arguments-desc="),
  );
  assert.equal(
    section(moduleText, "General").trim(),
    section(upstreamText, "General").trim(),
  );
  assert.equal(
    section(moduleText, "Header Rewrite").trim(),
    section(upstreamText, "Header Rewrite").trim(),
  );
  assert.equal(
    section(moduleText, "MITM").trim(),
    "hostname = %APPEND% gql.reddit.com, gql-fed.reddit.com",
  );
});

test("keeps the original GraphQL endpoint coverage", () => {
  assert.equal(optimizedRule.pattern, upstreamRule.pattern);
  const matcher = new RegExp(optimizedRule.pattern, "u");
  assert.equal(matcher.test("https://gql.reddit.com"), true);
  assert.equal(matcher.test("https://gql-fed.reddit.com"), true);
  assert.equal(matcher.test("https://example.com"), false);
});

test(
  "optimized traversal is output-equivalent for retained and removed objects",
  { skip: !jqAvailable },
  () => {
    const fixtures = [
      null,
      true,
      7,
      "text",
      [],
      {},
      {
        data: {
          isNsfw: true,
          isNsfwMediaBlocked: true,
          isNsfwContentShown: false,
          commentsPageAds: [{ id: 1 }],
          keep: true,
        },
      },
      {
        data: [
          {
            __typename: "AdPost",
            isNsfw: true,
            payload: {
              deeply: {
                nested: {
                  commentsPageAds: [{ id: "discarded-with-parent" }],
                },
              },
            },
          },
          {
            node: {
              cells: [{ __typename: "AdMetadataCell" }],
            },
            commentsPageAds: [{ id: 2 }],
          },
          {
            node: { adPayload: {} },
            isNsfwContentShown: false,
          },
          {
            node: {
              cells: [{ id: 3 }, { isAdPost: false }],
              adPayload: null,
            },
            keep: true,
          },
        ],
      },
      {
        isNsfw: 1,
        isNsfwMediaBlocked: "true",
        isNsfwContentShown: null,
        commentsPageAds: {},
        node: [],
      },
      {
        deeply: {
          nested: [
            {
              isOver18: true,
              isOver18MediaBlocked: true,
              isOver18ContentShown: false,
            },
          ],
        },
      },
    ];

    for (const fieldName of ["Nsfw", "Over18"]) {
      const upstreamFilter = substituteNsfw(upstreamRule.filter, fieldName);
      const optimizedFilter = substituteNsfw(optimizedRule.filter, fieldName);
      for (const fixture of fixtures) {
        const expected = spawnJq(upstreamFilter, fixture);
        const actual = spawnJq(optimizedFilter, fixture);
        assert.equal(expected.status, 0, expected.stderr);
        assert.equal(actual.status, 0, actual.stderr);
        assert.equal(actual.stdout, expected.stdout);
      }
    }
  },
);

test("optimized filter stops descending into guaranteed AdPost removals", () => {
  assert.match(optimizedRule.filter, /^def reddit_walk:/u);
  assert.match(
    optimizedRule.filter,
    /if \.__typename == "AdPost" then empty else map_values\(reddit_walk\)/u,
  );
  assert.doesNotMatch(optimizedRule.filter, /\bwalk\(/u);
});

test(
  "optimized rule still removes ads and applies the NSFW controls",
  { skip: !jqAvailable },
  () => {
    const output = runJq(substituteNsfw(optimizedRule.filter, "Nsfw"), {
      data: [
        { __typename: "AdPost" },
        { node: { adPayload: { id: "ad" } } },
        { node: { cells: [{ isAdPost: true }] } },
        {
          id: "normal",
          isNsfw: true,
          isNsfwMediaBlocked: true,
          isNsfwContentShown: false,
          commentsPageAds: [{ id: "comment-ad" }],
        },
      ],
    });
    assert.deepEqual(output, {
      data: [
        {
          id: "normal",
          isNsfw: false,
          isNsfwMediaBlocked: false,
          isNsfwContentShown: true,
          commentsPageAds: [],
        },
      ],
    });
  },
);

function header(text, prefix) {
  const matches = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(prefix));
  assert.equal(matches.length, 1, `Expected one ${prefix} header`);
  return matches[0];
}

function section(text, name) {
  const marker = `[${name}]`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const contentStart = start + marker.length;
  const next = text.indexOf("\n[", contentStart);
  return text.slice(contentStart, next === -1 ? text.length : next);
}

function bodyRule(text) {
  const lines = section(text, "Body Rewrite")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("http-response-jq "));
  assert.equal(lines.length, 1);
  const match = lines[0].match(/^http-response-jq\s+(.+?)\s+'(.+)'$/u);
  assert.ok(match, "Unable to parse Reddit Body Rewrite rule");
  return { pattern: match[1], filter: match[2] };
}

function substituteNsfw(filter, fieldName) {
  return filter.replaceAll("{{{NSFW}}}", fieldName);
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
