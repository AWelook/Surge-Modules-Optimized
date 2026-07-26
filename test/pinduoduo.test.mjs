import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const moduleText = await readFile(
  new URL("../modules/ad/pinduoduo-ads.sgmodule", import.meta.url),
  "utf8",
);
const convertedText = await readFile(
  new URL(
    "../converted/ad/pinduoduo-ads/script-hub.sgmodule",
    import.meta.url,
  ),
  "utf8",
);
const upstreamScript = await readFile(
  new URL(
    "../upstream/ad/pinduoduo-ads/PinDuoDuo_remove_ads.js",
    import.meta.url,
  ),
  "utf8",
);
const optimizedScript = await readFile(
  new URL(
    "../scripts/ad/pinduoduo-ads/PinDuoDuo_remove_ads.js",
    import.meta.url,
  ),
  "utf8",
);
const upstreamChunk = await readFile(
  new URL(
    "../upstream/ad/pinduoduo-ads/9410-b8806e870a26db7d.js",
    import.meta.url,
  ),
  "utf8",
);
const publishedChunk = await readFile(
  new URL(
    "../scripts/ad/pinduoduo-ads/9410-b8806e870a26db7d.js",
    import.meta.url,
  ),
  "utf8",
);
const registry = JSON.parse(
  await readFile(new URL("../registry.json", import.meta.url), "utf8"),
);
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;

const convertedRules = bodyRules(convertedText);
const optimizedRules = bodyRules(moduleText);
const upstreamChunkUrl =
  "https://kelee.one/Resource/JavaScript/PinDuoDuo/9410-b8806e870a26db7d.js";
const publishedChunkUrl =
  "https://cdn.jsdelivr.net/gh/AWelook/Surge-Modules-Optimized@main/scripts/ad/pinduoduo-ads/9410-b8806e870a26db7d.js";

test("keeps an exact Script Hub 1.14.14 Loon conversion baseline", () => {
  assert.match(convertedText, /^#!name=拼多多去广告$/mu);
  assert.match(convertedText, /^\[Rule\]$/mu);
  assert.match(convertedText, /^\[Body Rewrite\]$/mu);
  assert.match(convertedText, /^\[Map Local\]$/mu);
  assert.match(convertedText, /^\[Script\]$/mu);
  assert.match(convertedText, /^\[MITM\]$/mu);

  const entry = registry.find(({ slug }) => slug === "pinduoduo-ads");
  assert.ok(entry);
  assert.deepEqual(entry.conversion, {
    provider: "Script Hub",
    version: "1.14.14",
    sourceType: "loon-plugin",
    targetType: "surge-module",
    snapshot: "converted/ad/pinduoduo-ads/script-hub.sgmodule",
  });
  assert.deepEqual(entry.dependencies, [
    {
      url: upstreamChunkUrl,
      fileName: "9410-b8806e870a26db7d.js",
    },
  ]);
});

test("preserves rules while removing only the duplicate titan rule", () => {
  const converted = functionalLines(section(convertedText, "Rule"));
  const optimized = functionalLines(section(moduleText, "Rule"));
  assert.equal(converted.length, optimized.length + 1);
  assert.equal(
    converted.filter((line) => line === "DOMAIN,titan.pinduoduo.com,REJECT")
      .length,
    2,
  );
  assert.equal(
    optimized.filter((line) => line === "DOMAIN,titan.pinduoduo.com,REJECT")
      .length,
    1,
  );
  assert.deepEqual(new Set(optimized), new Set(converted));
});

test("preserves every Map Local and MITM entry", () => {
  assert.deepEqual(
    functionalLines(section(moduleText, "Map Local")),
    functionalLines(section(convertedText, "Map Local")),
  );
  assert.equal(
    section(moduleText, "MITM").trim(),
    section(convertedText, "MITM").trim(),
  );
  assert.equal(
    functionalLines(section(moduleText, "Map Local")).length,
    20,
  );
});

test("reduces 18 Body Rewrite passes to seven unique endpoint passes", () => {
  assert.equal(convertedRules.length, 18);
  assert.equal(optimizedRules.length, 7);
  assert.deepEqual(
    optimizedRules.map(({ pattern }) => pattern),
    [...new Set(convertedRules.map(({ pattern }) => pattern))],
  );
});

test(
  "merged Body Rewrite filters preserve sequential Script Hub output",
  { skip: !jqAvailable },
  () => {
    const fixtures = new Map([
      [
        "homepage\\/hub",
        {
          result: {
            dy_module: { irregular_banner_dy: [1], keep: true },
            icon_set: [2],
            search_bar_hot_query: [3],
            bottom_tabs: [
              { link: "index.html", id: 1 },
              { link: "video.html", id: 2 },
            ],
            buffer_bottom_tabs: [
              { link: "chat_list.html", id: 3 },
              { link: "mall.html", id: 4 },
            ],
            all_top_opts: [
              {
                id: 5,
                selected_image: "a",
                image: "b",
                height: 10,
                width: 20,
                keep: true,
              },
            ],
          },
        },
      ],
      ["\\/search\\?", { expansion: [1], keep: true }],
      [
        "personal\\/hub",
        {
          monthly_card_entrance: 1,
          personal_center_style_v2_vo: 2,
          icon_set: { icons: [3], top_personal_icons: [4], keep: true },
          personal_banner: 5,
          keep: true,
        },
      ],
      [
        "integration\\/render",
        {
          bottom_section_list: [1],
          ui: {
            bottom_section: [2],
            live_section: { float_info: 3, keep: true },
          },
          keep: true,
        },
      ],
      [
        "order_detail_group",
        { data: { goods_list: [1], keep: true }, keep: true },
      ],
      [
        "\\/order\\/",
        {
          marketing_banner_vo: 1,
          shipping: { banner_above_recommend: 2, keep: true },
          keep: true,
        },
      ],
      [
        "order_list_v4",
        {
          orders: [
            {
              id: 1,
              order_buttons: [
                { id: 2, order_growth_tip: "ad", keep: true },
              ],
            },
          ],
        },
      ],
    ]);

    for (const [fragment, input] of fixtures) {
      const originalFilters = convertedRules
        .filter(({ pattern }) => pattern.includes(fragment))
        .map(({ filter }) => filter);
      const optimizedFilter = optimizedRules.find(({ pattern }) =>
        pattern.includes(fragment),
      )?.filter;
      assert.ok(originalFilters.length);
      assert.ok(optimizedFilter);
      assert.deepEqual(
        runJq(optimizedFilter, input),
        runJqSequence(originalFilters, input),
        `Merged output differs for ${fragment}`,
      );
    }
  },
);

test("rehosts both script layers without changing the HTML transformer", () => {
  assert.equal(publishedChunk, upstreamChunk);
  assert.equal(
    optimizedScript
      .replace(publishedChunkUrl, upstreamChunkUrl)
      .trimEnd(),
    upstreamScript.trimEnd(),
  );
  assert.match(
    section(moduleText, "Script"),
    /raw\.githubusercontent\.com\/AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\/pinduoduo-ads\/PinDuoDuo_remove_ads\.js/u,
  );
  assert.match(optimizedScript, new RegExp(escapeRegExp(publishedChunkUrl), "u"));
  assert.doesNotMatch(optimizedScript, /kelee\.one/u);
});

test("optimized script preserves HTML output apart from the rehosted chunk URL", () => {
  const nextData = {
    props: {
      pageProps: {
        serverData: [
          { key: "advertisement", value: 1 },
          { key: "fastBindCMobilePreCheck", value: 2 },
          { key: "queryStationPackageInfo", value: 3 },
        ],
      },
    },
  };
  const fixtures = [
    "",
    `<script src="https://pfile.pddpic.com/mdkd/mdkd/_next/static/chunks/9410-b8806e870a26db7d.js"></script>`,
    `<main><div class="index_gif-container"><div>ad</div></div><p>keep</p></main>`,
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`,
    `<script id="__NEXT_DATA__" type="application/json">{</script>`,
  ];

  for (const html of fixtures) {
    assert.equal(
      runScript(optimizedScript, html).replace(
        publishedChunkUrl,
        upstreamChunkUrl,
      ),
      runScript(upstreamScript, html),
    );
  }

  const transformed = runScript(
    optimizedScript,
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`,
  );
  const jsonText = transformed.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.+)<\/script>/u,
  )?.[1];
  assert.ok(jsonText);
  assert.deepEqual(
    JSON.parse(jsonText).props.pageProps.serverData.map(({ key }) => key),
    ["fastBindCMobilePreCheck", "queryStationPackageInfo"],
  );
});

function section(text, name) {
  const marker = `[${name}]`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const contentStart = start + marker.length;
  const next = text.indexOf("\n[", contentStart);
  return text.slice(contentStart, next === -1 ? text.length : next);
}

function functionalLines(content) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function bodyRules(text) {
  return functionalLines(section(text, "Body Rewrite")).map((line) => {
    const match = line.match(/^http-response-jq\s+(.+?)\s+'(.+)'$/u);
    assert.ok(match, `Unable to parse Body Rewrite rule: ${line}`);
    return { pattern: match[1], filter: match[2] };
  });
}

function runJq(filter, input) {
  const result = spawnSync("jq", ["-c", filter], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runJqSequence(filters, input) {
  return filters.reduce((value, filter) => runJq(filter, value), input);
}

function runScript(script, body) {
  let result;
  vm.runInNewContext(
    script,
    {
      $response: { body },
      $done: (value) => {
        result = value;
      },
    },
    { timeout: 1_000 },
  );
  return result.body;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
