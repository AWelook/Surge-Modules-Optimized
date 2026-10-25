import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parseSections, COMBINED_SOURCES } from "../scripts/build-combined-module.mjs";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [published, baseline, upstream, combined, registryText] = await Promise.all([
  read("modules/ad/zhihu-ads.sgmodule"),
  read("converted/ad/zhihu-ads/script-hub.sgmodule"),
  read("upstream/ad/zhihu-ads/module.lpx"),
  read("modules/ad/ad-combined.sgmodule"),
  read("registry.json"),
]);
const sections = parseSections(published);
const originalSections = parseSections(baseline);
const bodyRules = (text) => lines(parseSections(text).get("Body Rewrite")).map((line) => {
  const match = line.match(/^http-response-jq (\S+) '(.+)'$/u);
  assert.ok(match, line);
  return { pattern: match[1], filter: match[2] };
});
const rules = bodyRules(published);
const baselineRules = bodyRules(baseline);
const jqAvailable = spawnSync("jq", ["--version"]).status === 0;

test("Zhihu is registered with its exact Loon source and pinned Script Hub Beta provenance", () => {
  const entry = JSON.parse(registryText).find(({ slug }) => slug === "zhihu-ads");
  assert.equal(entry.moduleUrl, "https://kelee.one/Tool/Loon/Lpx/Zhihu_remove_ads.lpx");
  assert.equal(entry.conversion.revision, "7162288ce04b37a7922f3da3c1a6021d6d81dbc0");
  assert.equal(entry.conversion.parser, "Rewrite-Parser.beta.js");
  assert.equal(entry.conversion.sourceType, "loon-plugin");
  assert.equal(entry.conversion.targetType, "surge-module");
  assert.deepEqual(entry.scripts, []);
  assert.ok(entry.sync.retainExistingOnFailure);
  assert.ok(COMBINED_SOURCES.some(({ file }) => file === entry.moduleFile));
  assert.match(upstream, /^#!date=2026-10-02 13:57:49$/mu);
});

test("conversion preserves all 30 Loon actions, case-insensitive matching and MITM hosts", () => {
  const requests = upstream.split("\n").filter((line) => line.startsWith("request if "));
  const responses = upstream.split("\n").filter((line) => line.startsWith("response if "));
  assert.equal(requests.length, 15);
  assert.equal(responses.length, 15);
  assert.equal(lines(sections.get("Map Local")).length, requests.length);
  assert.equal(baselineRules.length, 19); // Four multi-key deletions expand to separate jq actions.
  assert.equal(rules.length, 13);
  assert.deepEqual([...new Set(baselineRules.map(({ pattern }) => pattern))], rules.map(({ pattern }) => pattern));
  for (const rule of rules) assert.ok(rule.pattern.startsWith("(?i)"));
  assert.equal(sections.get("MITM"), originalSections.get("MITM"));
  for (const text of [published, combined]) {
    assert.doesNotMatch(text, /^\[Rewrite\]$|^(?:request|response) if /mu);
  }
  assert.doesNotMatch(published, /^\[Script\]$|script-path=|^#!loon_version=/mu);
  for (const host of ["m-cloud.zhihu.com", "api.zhihu.com", "www.zhihu.com", "page-info.zhihu.com", "zhida.zhihu.com"]) {
    assert.ok(parseSections(combined).get("MITM").includes(host));
  }
});

test("Script Hub retains the JSON operations of every native response rule", () => {
  const expected = upstream.split("\n").filter((line) => line.startsWith("response if ")).flatMap((line) => {
    const match = line.match(/^response if \$\{url\} ~= \/(.+)\/i then response\.json\.(jq|delete)\((.+)\)$/u);
    assert.ok(match, line);
    const pattern = "(?i)" + match[1];
    const value = JSON.parse(match[3]);
    return match[2] === "jq"
      ? [{ pattern, filter: value }]
      : (Array.isArray(value) ? value : [value]).map((key) => ({ pattern, filter: `delpaths(${JSON.stringify([key.split(".")])})` }));
  });
  assert.deepEqual(baselineRules, expected);
});

// Each request action gets an independent representative URL, including the
// narrower commercial endpoints also covered by the upstream's broad rule.
const requestUrls = [
  "https://api.zhihu.com/ad-style-service/request",
  "https://api.zhihu.com/commercial_api/launch_v2",
  "https://api.zhihu.com/commercial_api/banners_v3/app_float_corner?x=1",
  "https://api.zhihu.com/next-render?id=42&type=answer",
  "https://api.zhihu.com/commercial_api/answer/42/bottom-v2",
  "https://api.zhihu.com/related_recommend/feed/waterfall?x=1",
  "https://api.zhihu.com/search/preset_words?x=1",
  "https://api.zhihu.com/search/related_queries/question/42",
  "https://zhida.zhihu.com/ai_ingress/knowledge/square/categories/feeds?categoryId=1%7D",
  "https://zhida.zhihu.com/ai_ingress/ai_chat/guidance",
  "https://api.zhihu.com/content-distribution-core/bubble/common/show",
  "https://www.zhihu.com/api/v4/members/homepage_card",
  "https://api.zhihu.com/people/homepage_entry_v2",
  "https://api.zhihu.com/kvip/right/my_card?x=1",
  "https://api.zhihu.com/unlimited/go/my_card/v2?x=1",
];
const upstreamRequests = upstream.split("\n").filter((line) => line.startsWith("request if "));
const mapLines = lines(sections.get("Map Local"));
for (const [index, url] of requestUrls.entries()) {
  test(`Zhihu Map Local returns JSON {} with HTTP 200: ${url}`, () => {
    const native = upstreamRequests[index].match(/~= \/(.+)\/i then reject_dict\(200\)$/u);
    assert.ok(native, upstreamRequests[index]);
    assert.ok(new RegExp(native[1], "i").test(url));
    const pattern = mapLines[index].split(/\s+/u)[0];
    for (const input of [url, url.toUpperCase()]) assert.ok(regex(pattern).test(input));
    assert.match(mapLines[index], / data-type=text data="\{\}" status-code=200 header="Content-Type:application\/json"$/u);
    assert.ok(!regex(pattern).test(url.replace("zhihu.com", "example.com")));
  });
}

const cases = [
  ["cloud config", "https://m-cloud.zhihu.com/api/cloud/zhihu/config/all?x=1",
    { data: { configs: [
      ...["km_httpdns_new_config_tars", "preFetchHttpDns", "httpdns_detector_use_concurrent", "httpdns_use_memory_cache", "httpdns_new_config_tars", "coreNetworkConf_useTars", "km_coreNetworkConf_useTars", "sugarQuicConfig", "quic_dns_detect_enable", "quicMixAB", "quic_downgrade_enable", "quic_priority_strategy", "quic_check_health_enable", "tquic_configuration", "networkExprimentList", "tars_ab_list", "zaSetExtraRequestHeader"].map((configKey) => ({ configKey, configValue: true })),
      { configKey: "normal", configValue: { delayHttpdns: true, dnsParser: {}, HTTPDNS: {}, keep: 1 } },
      { configKey: "scalar", configValue: "keep" },
    ] }, keep: true },
    { data: { configs: [{ configKey: "normal", configValue: { keep: 1 } }, { configKey: "scalar", configValue: "keep" }] }, keep: true }],
  ["root tabs", "https://api.zhihu.com/root/tab/v3?x=1",
    { tab_list: ["follow", "recommend", "hot", "ring_tab", "vip", "ads"].map((tab_type) => ({ tab_type })), keep: true },
    { tab_list: ["follow", "recommend", "hot", "ring_tab"].map((tab_type) => ({ tab_type })), keep: true }],
  ["recommendation feed", "https://api.zhihu.com/topstory/recommend?x=1",
    { data: [{ type: "ComponentCard", id: 1, children: [{ id: "ring" }, { id: "answer" }] }, { type: "feed_advert" }, { type: "ComponentCard", id: 2 }], keep: true },
    { data: [{ type: "ComponentCard", id: 1, children: [{ id: "answer" }] }, { type: "ComponentCard", id: 2, children: null }], keep: true }],
  ["question feeds", "https://api.zhihu.com/questions/42/feeds?x=1", { ad_info: {}, data: [{ id: 1 }] }, { data: [{ id: 1 }] }],
  ["answer comments", "https://api.zhihu.com/comment_v5/answers/42/root_comment?x=1", { atmosphere_voting_config: {}, data: [{ text: "keep" }] }, { data: [{ text: "keep" }] }],
  ["pin comments", "https://api.zhihu.com/comment_v5/pins/42/root_comment?x=1", { atmosphere_voting_config: {}, data: [] }, { data: [] }],
  ...["api.zhihu.com", "page-info.zhihu.com"].map((host) => ["answer detail " + host, `https://${host}/answers/v2/42?x=1`,
    { third_business: {}, float_search_word: {}, ring_info: {}, interaction_bar_plugins: [], structured_content: { segments: [{ type: "card" }, { type: "text", text: "keep" }] }, content: "keep" },
    { ...(host.startsWith("page-info") ? { ring_info: {}, interaction_bar_plugins: [] } : {}), structured_content: { segments: [{ type: "text", text: "keep" }] }, content: "keep" }]),
  ...["articles", "pins"].map((kind) => [kind + " details", `https://api.zhihu.com/${kind}/v2/42?x=1`, { third_business: {}, ring_info: {}, interaction_bar_plugins: [], content: "keep" }, { content: "keep" }]),
  ["comment header", "https://api.zhihu.com/comment_v5/answers/42/list-headers", { continuous_consumption_module: {}, keep: 1 }, { keep: 1 }],
  ["podcast banners", "https://api.zhihu.com/podcasts/hub/v2", { banners: [], data: [{ id: 1 }] }, { data: [{ id: 1 }] }],
  ["search recommendations", "https://api.zhihu.com/search/recommend_query/v2?x=1", { recommend_queries: { queries: [{ type: "ad" }, { type: "normal", text: "keep" }] } }, { recommend_queries: { queries: [{ type: "normal", text: "keep" }] } }],
  ["search pendants", "https://api.zhihu.com/search_v3?x=1", { pendant: {}, data: [{ id: 1 }] }, { data: [{ id: 1 }] }],
  ["search tabs", "https://api.zhihu.com/search/tabs?x=1", { data: ["general", "ai_zhida", "recent", "people", "zvideo", "ring", "topic", "podcast", "column", "pin", "favlist", "ad"].map((t) => ({ t })) }, { data: ["general", "ai_zhida", "recent", "people", "zvideo", "ring", "topic", "podcast", "column", "pin", "favlist"].map((t) => ({ t })) }],
  ["profile VIP prompts", "https://api.zhihu.com/people/self", { vip_info: { entrance_new: { right_button: {}, left_button: "keep" }, entrance_v2: {}, is_vip: true }, name: "keep" }, { vip_info: { entrance_new: { left_button: "keep" }, is_vip: true }, name: "keep" }],
];

for (const [label, url, input, expected] of cases) {
  test(`Zhihu removes intended fields and keeps ordinary content: ${label}`, { skip: !jqAvailable }, () => {
    const selected = rules.filter(({ pattern }) => regex(pattern).test(url));
    assert.ok(selected.length);
    const result = jq(selected.map(({ filter }) => `(${filter})`).join(" | "), input);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    const combinedRules = bodyRules(combined).filter(({ pattern }) => regex(pattern).test(url));
    assert.deepEqual(combinedRules, selected);
  });
}

test("merging same-endpoint jq passes preserves converted behavior including malformed/absent data", { skip: !jqAvailable }, () => {
  const fixtures = [{}, { data: null }, { data: [] }, { data: {} }, { data: "text" }, ...cases.map(([, , input]) => input)];
  for (const { pattern, filter } of rules) {
    const before = baselineRules.filter((rule) => rule.pattern === pattern).map((rule) => `(${rule.filter})`).join(" | ");
    for (const fixture of fixtures) {
      const original = jq(before, fixture);
      const optimized = jq(filter, fixture);
      assert.equal(optimized.status, original.status, pattern);
      if (original.status === 0) assert.deepEqual(JSON.parse(optimized.stdout), JSON.parse(original.stdout));
    }
  }
});

test("normal answer fetching, login and unrelated websites are not mocked", () => {
  for (const url of ["https://api.zhihu.com/answers/v2/42?x=1", "https://api.zhihu.com/questions/42/answers", "https://api.zhihu.com/oauth/token", "https://www.example.com/"]) {
    assert.ok(!mapLines.some((line) => regex(line.split(/\s+/u)[0]).test(url)), url);
  }
  assert.equal(sections.get("Map Local"), originalSections.get("Map Local"));
});

function lines(text = "") {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}
function regex(pattern) {
  return pattern.startsWith("(?i)") ? new RegExp(pattern.slice(4), "iu") : new RegExp(pattern, "u");
}
function jq(filter, input) {
  return spawnSync("jq", ["-c", filter], { input: JSON.stringify(input), encoding: "utf8" });
}
