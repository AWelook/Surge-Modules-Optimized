import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const moduleText = await readFile(
  new URL("../modules/ad/didichuxing.sgmodule", import.meta.url),
  "utf8",
);
const convertedText = await readFile(
  new URL(
    "../converted/ad/didichuxing/script-hub.sgmodule",
    import.meta.url,
  ),
  "utf8",
);
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;

test("keeps the exact Script Hub 1.14.14 conversion baseline", () => {
  assert.match(convertedText, /^#!name=滴滴出行$/mu);
  assert.equal(ruleLines(convertedText).length, 16);
  assert.equal(bodyRules(convertedText).length, 12);
  assert.equal(mapLocalLines(convertedText).length, 12);
  assert.doesNotMatch(convertedText, /^\[Script\]$/mu);
});

test("published module preserves non-JQ behavior and disables IP resolution", () => {
  for (const name of ["Map Local", "MITM"]) {
    assert.equal(section(moduleText, name), section(convertedText, name));
  }
  assert.deepEqual(
    ruleLines(moduleText).map((line) => line.replace(/,no-resolve$/u, "")),
    ruleLines(convertedText),
  );
  const ipRules = ruleLines(moduleText).filter((line) =>
    line.startsWith("IP-CIDR,"),
  );
  assert.equal(ipRules.length, 15);
  for (const line of ipRules) {
    assert.match(line, /,no-resolve$/u);
  }
  assert.doesNotMatch(moduleText, /script-path\s*=/u);
  for (const line of mapLocalLines(moduleText)) {
    assert.match(
      line,
      /data-type=text data="\{\}" status-code=200 header="Content-Type:application\/json"$/u,
    );
  }
});

test("only the two double-pass JQ filters differ from the conversion", () => {
  const convertedRules = bodyRules(convertedText);
  const optimizedRules = bodyRules(moduleText);
  assert.deepEqual(
    optimizedRules.map(({ pattern }) => pattern),
    convertedRules.map(({ pattern }) => pattern),
  );

  const changedPatterns = [];
  for (let index = 0; index < optimizedRules.length; index += 1) {
    if (optimizedRules[index].filter !== convertedRules[index].filter) {
      changedPatterns.push(optimizedRules[index].pattern);
    }
  }
  assert.deepEqual(changedPatterns, [
    String.raw`^https:\/\/common\.diditaxi\.com\.cn\/common\/v\d\/usercenter\/me`,
    String.raw`^https:\/\/mapi\.xiaojukeji\.com\/passenger-wallet\/api\/v[\d.]+\/wallet\/homepage`,
  ]);
});

test(
  "single-pass user-center filter is behavior-equivalent",
  { skip: !jqAvailable },
  () => {
    const input = {
      data: {
        cards: [
          { title: "天天领福利", tag: "wallet", items: [{ title: "优惠券" }] },
          {
            id: 1,
            title: "钱包",
            tag: "wallet",
            card_type: 4,
            items: [{ title: "优惠券" }, { title: "借钱" }],
            bottom_items: [
              { title: "省钱套餐" },
              { title: "出行里程" },
              { title: "广告" },
            ],
          },
          {
            id: 2,
            title: "普通卡片",
            tag: "normal",
            items: [{ title: "保持原样" }],
          },
          null,
        ],
      },
    };
    const original = filterFor(convertedText, "usercenter\\/me");
    const optimized = filterFor(moduleText, "usercenter\\/me");
    assert.deepEqual(runJq(optimized, input), runJq(original, input));
    assert.deepEqual(runJq(optimized, input).data.cards, [
      {
        id: 1,
        title: "钱包",
        tag: "wallet",
        card_type: 4,
        items: [{ title: "优惠券" }],
        bottom_items: [{ title: "省钱套餐" }, { title: "出行里程" }],
      },
      {
        id: 2,
        title: "普通卡片",
        tag: "normal",
        items: [{ title: "保持原样" }],
      },
      null,
    ]);
  },
);

test(
  "single-pass wallet filter is behavior-equivalent",
  { skip: !jqAvailable },
  () => {
    const input = {
      data: {
        cardList: [
          {
            id: 1,
            mcode: "index_assets_v6",
            detailData: {
              myCreditLimit: 5000,
              discountList: [1, 2, 3, 4, 5],
              noticeList: ["ad"],
              balance: 100,
            },
          },
          {
            id: 2,
            mcode: "other",
            detailData: { keep: true },
          },
          {
            id: 3,
            mcode: "index_assets_v6",
            detailData: {
              discountList: [6, 7],
              balance: 200,
            },
          },
        ],
      },
    };
    const original = filterFor(convertedText, "wallet\\/homepage");
    const optimized = filterFor(moduleText, "wallet\\/homepage");
    assert.deepEqual(runJq(optimized, input), runJq(original, input));
    assert.deepEqual(runJq(optimized, input).data.cardList, [
      {
        id: 1,
        mcode: "index_assets_v6",
        detailData: {
          discountList: [1, 2, 3],
          balance: 100,
        },
      },
      {
        id: 3,
        mcode: "index_assets_v6",
        detailData: {
          discountList: [6, 7],
          balance: 200,
        },
      },
    ]);
  },
);

function section(text, name) {
  const marker = `[${name}]`;
  const markerIndex = text.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing ${marker} section`);
  const contentStart = markerIndex + marker.length;
  const nextSection = text.indexOf("\n[", contentStart);
  return text.slice(
    contentStart,
    nextSection === -1 ? text.length : nextSection,
  );
}

function ruleLines(text) {
  return section(text, "Rule")
    .split("\n")
    .filter((line) => /^(?:DOMAIN|IP-CIDR),/u.test(line));
}

function mapLocalLines(text) {
  return section(text, "Map Local")
    .split("\n")
    .filter((line) => line.startsWith("^https"));
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

function filterFor(text, patternFragment) {
  const matches = bodyRules(text).filter(({ pattern }) =>
    pattern.includes(patternFragment),
  );
  assert.equal(matches.length, 1, `Expected one filter for ${patternFragment}`);
  return matches[0].filter;
}

function runJq(filter, input) {
  const result = spawnSync("jq", ["-c", filter], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
