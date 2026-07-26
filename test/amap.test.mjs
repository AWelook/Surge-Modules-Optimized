import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const moduleText = await readFile(
  new URL("../modules/ad/amap-ads.sgmodule", import.meta.url),
  "utf8",
);
const convertedText = await readFile(
  new URL("../converted/ad/amap-ads/script-hub.sgmodule", import.meta.url),
  "utf8",
);
const upstreamAmapText = await readFile(
  new URL("../upstream/ad/amap-ads/amap.js", import.meta.url),
  "utf8",
);
const optimizedAmapText = await readFile(
  new URL("../scripts/ad/amap-ads/amap.js", import.meta.url),
  "utf8",
);
const upstreamAmdcText = await readFile(
  new URL("../upstream/ad/amap-ads/amdc.js", import.meta.url),
  "utf8",
);
const optimizedAmdcText = await readFile(
  new URL("../scripts/ad/amap-ads/amdc.js", import.meta.url),
  "utf8",
);

const amapCases = [
  {
    name: "splash advertisement",
    url: "https://m5.amap.com/ws/valueadded/alimama/splash_screen",
    input: {
      data: {
        ad: [
          {
            set: { setting: { display_time: 15 } },
            creative: [{ start_time: 1, end_time: 2 }],
          },
        ],
      },
    },
  },
  {
    name: "main page",
    url: "https://m5.amap.com/ws/faas/amap-navigation/main-page",
    input: {
      data: {
        cardList: {
          login: { dataType: "LoginCard", id: 1 },
          ad: { dataType: "Advertisement", id: 2 },
          frequent: { dataType: "FrequentLocation", id: 3 },
        },
        pull3: { msgs: [{ id: 1 }] },
        business_position: [{ id: 2 }],
        mapBizList: [{ id: 3 }],
        keep: true,
      },
    },
  },
  {
    name: "profile",
    url: "https://m5.amap.com/ws/shield/dsp/profile/index/nodefaas",
    input: {
      data: {
        tipData: { text: "ad" },
        cardList: {
          order: { dataType: "MyOrderCard", id: 1 },
          recommend: { dataType: "GdRecommendCard", id: 2 },
          ad: { dataType: "Advertisement", id: 3 },
        },
        keep: true,
      },
    },
  },
  {
    name: "hot words",
    url: "https://m5.amap.com/ws/shield/search/new_hotword",
    input: { data: { header_hotword: [{ text: "ad" }], keep: true } },
  },
  {
    name: "promotion resource",
    url: "https://m5.amap.com/ws/promotion-web/resource",
    input: {
      data: {
        icon: [1],
        banner: [2],
        tips: [3],
        popup: [4],
        bubble: [5],
        other: [6],
        keep: [7],
      },
    },
  },
  {
    name: "message box",
    url: "https://m5.amap.com/ws/msgbox/pull",
    input: {
      msgs: [{ id: 1 }],
      pull3: { msgs: [{ id: 2 }], keep: true },
      keep: true,
    },
  },
  {
    name: "notice list",
    url: "https://m5.amap.com/ws/message/notice/list",
    input: { data: { noticeList: [{ id: 1 }], keep: true } },
  },
  {
    name: "AOCS configuration",
    url: "https://m5.amap.com/ws/shield/frogserver/aocs/updatable",
    input: {
      data: {
        gd_notch_logo: { value: "ad" },
        home_business_position_config_v2: { value: "ad" },
        his_input_tip: { value: "ad" },
        operation_layer: { value: "ad" },
        aiNativeCard: { value: "ad" },
        prefix_ai_card: { value: "ad" },
        feature_ai: { value: "ad" },
        keep: { value: "normal" },
      },
    },
  },
  {
    name: "nearby recommendations",
    url: "https://m5.amap.com/ws/shield/search/nearbyrec_smart",
    input: {
      data: {
        coupon: { id: 1 },
        scene: { id: 2 },
        activity: { id: 3 },
        commodity_rec: { id: 4 },
        operation_activity: { id: 5 },
        modules: [
          "coupon",
          "scene",
          "activity",
          "commodity_rec",
          "operation_activity",
          "keep",
        ],
        keep: true,
      },
    },
  },
  {
    name: "unmatched endpoint",
    url: "https://m5.amap.com/ws/other",
    input: { data: { keep: true } },
  },
];

test("keeps a complete Script Hub conversion baseline", () => {
  assert.equal(sectionLines(convertedText, "Rule").length, 1);
  assert.equal(sectionLines(convertedText, "URL Rewrite").length, 1);
  assert.equal(sectionLines(convertedText, "Map Local").length, 7);
  assert.equal(scriptLines(convertedText).length, 10);
  assert.match(convertedText, /^#!name=AmapAds$/mu);
});

test("preserves all non-script conversion behavior", () => {
  for (const name of ["Rule", "URL Rewrite", "MITM"]) {
    assert.equal(
      section(moduleText, name).trimEnd(),
      section(convertedText, name).trimEnd(),
    );
  }
  assert.equal(
    section(moduleText, "Map Local").replaceAll('data=""', 'data=" "'),
    section(convertedText, "Map Local"),
  );
});

test("merges nine Amap registrations without losing endpoint coverage", () => {
  const publishedScripts = scriptLines(moduleText);
  assert.equal(publishedScripts.length, 2);
  assert.equal(
    publishedScripts.filter((line) => line.startsWith("amap =")).length,
    1,
  );

  const amapLine = publishedScripts.find((line) => line.startsWith("amap ="));
  const match = amapLine.match(/pattern=(.+?), script-path=/u);
  assert.ok(match);
  const pattern = new RegExp(match[1], "u");
  for (const { name, url } of amapCases.slice(0, -1)) {
    assert.equal(pattern.test(url), true, name);
  }
  assert.equal(pattern.test(amapCases.at(-1).url), false);
});

test("uses optimized repository scripts with original body limits", () => {
  const scripts = section(moduleText, "Script");
  assert.match(
    scripts,
    /scripts\/ad\/amap-ads\/amdc\.js, requires-body=true, max-size=-1, timeout=60/u,
  );
  assert.match(
    scripts,
    /scripts\/ad\/amap-ads\/amap\.js, requires-body=true, max-size=-1, timeout=60/u,
  );
  assert.doesNotMatch(
    scripts,
    /raw\.githubusercontent\.com\/ddgksf2013\/Scripts/u,
  );
});

for (const fixture of amapCases) {
  test(`Amap script preserves ${fixture.name} behavior`, () => {
    const upstream = runResponseScript(
      upstreamAmapText,
      fixture.url,
      fixture.input,
    );
    const optimized = runResponseScript(
      optimizedAmapText,
      fixture.url,
      fixture.input,
    );
    assert.deepEqual(optimized, upstream);
  });
}

test("Amap script keeps strict JSON parse failures", () => {
  assert.throws(
    () => runResponseScript(upstreamAmapText, amapCases[0].url, undefined, "{"),
    (error) => error?.name === "SyntaxError",
  );
  assert.throws(
    () =>
      runResponseScript(optimizedAmapText, amapCases[0].url, undefined, "{"),
    (error) => error?.name === "SyntaxError",
  );
});

test("AMDC output remains byte-for-byte equivalent", () => {
  for (const userAgent of [
    "AMap/15.0",
    "Cainiao/8.0",
    "%E9%97%B2%E9%B1%BC/7.0",
    "Alibaba/1.0",
    "Safari/18.0",
    "闲鱼/7.0",
    undefined,
  ]) {
    assert.deepEqual(
      runAmdc(optimizedAmdcText, userAgent),
      runAmdc(upstreamAmdcText, userAgent),
      userAgent,
    );
  }
});

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

function sectionLines(text, name) {
  return section(text, name)
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
}

function scriptLines(text) {
  return sectionLines(text, "Script").filter((line) =>
    /^[A-Za-z0-9_-]+\s*=/u.test(line),
  );
}

function runResponseScript(script, url, input, rawBody) {
  let output;
  vm.runInNewContext(
    script,
    {
      $request: { url },
      $response: {
        body: rawBody ?? JSON.stringify(input),
      },
      $done: (value) => {
        output = value;
      },
      decodeURIComponent,
    },
    { timeout: 1_000 },
  );
  return JSON.parse(JSON.stringify(output));
}

function runAmdc(script, userAgent) {
  let output;
  const headers =
    userAgent === undefined ? {} : { "User-Agent": userAgent };
  vm.runInNewContext(
    script,
    {
      $request: { headers },
      $done: (value) => {
        output = value;
      },
    },
    { timeout: 1_000 },
  );
  return JSON.parse(JSON.stringify(output));
}
