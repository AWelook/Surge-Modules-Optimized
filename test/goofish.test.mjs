import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const modulePath = new URL("../modules/ad/goofish-ads.sgmodule", import.meta.url);
const convertedPath = new URL(
  "../converted/ad/goofish-ads/script-hub.sgmodule",
  import.meta.url,
);
const scriptPath = new URL(
  "../scripts/ad/goofish-ads/amdc.js",
  import.meta.url,
);
const moduleText = await readFile(modulePath, "utf8");
const convertedText = await readFile(convertedPath, "utf8");
const scriptText = await readFile(scriptPath, "utf8");
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;

test("keeps an exact Script Hub conversion baseline", () => {
  assert.match(convertedText, /^#!name=GoofishAds$/mu);
  assert.match(convertedText, /^\[Body Rewrite\]$/mu);
  assert.match(convertedText, /data=" " status-code=200/u);
  assert.match(
    convertedText,
    /script-path=https:\/\/raw\.githubusercontent\.com\/ddgksf2013\/Scripts/u,
  );
});

test("published Surge module uses the optimized repository AMDC script", () => {
  assert.match(
    moduleText,
    /AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\/goofish-ads\/amdc\.js/u,
  );
  assert.doesNotMatch(
    moduleText,
    /script-path=https:\/\/raw\.githubusercontent\.com\/ddgksf2013/u,
  );
  assert.match(moduleText, /requires-body=true, max-size=-1, timeout=5/u);
});

test("Map Local returns a real empty body", () => {
  const mapLocal = section("Map Local");
  assert.equal((mapLocal.match(/data="" status-code=200/gu) ?? []).length, 2);
  assert.doesNotMatch(mapLocal, /data=" " status-code=200/u);
});

test("each search endpoint matches exactly one Body Rewrite rule", () => {
  for (const url of [
    "https://acs.m.goofish.com/gw/mtop.taobao.idlemtopsearch.search.shade/1.0/?x=1",
    "https://g-acs.m.goofish.com/gw/mtop.taobao.idlemtopsearch.search.discover/1.0/?x=1",
    "https://acs.m.goofish.com/gw/mtop.taobao.idlemtopsearch.search/1.0/?x=1",
  ]) {
    const matches = bodyRules().filter(({ pattern }) =>
      new RegExp(pattern, "u").test(url),
    );
    assert.equal(matches.length, 1, `${url} matched ${matches.length} rules`);
  }
});

test("all original Body Rewrite endpoints remain covered once", () => {
  for (const endpoint of [
    "mtop.taobao.idle.user.strategy.list",
    "mtop.taobao.idlehome.home.circle.list",
    "mtop.taobao.idlehome.home.nextfresh",
    "mtop.taobao.idlemtopsearch.search.shade",
    "mtop.taobao.idlemtopsearch.item.search.activate",
    "mtop.taobao.idlemtopsearch.search.discover",
    "mtop.idle.user.page.my.adapter",
    "mtop.taobao.idle.item.buy.feeds",
    "mtop.taobao.idle.local.home",
    "mtop.taobao.idlemtopsearch.search",
    "mtop.taobao.idle.item.recommend",
  ]) {
    const url = `https://acs.m.goofish.com/gw/${endpoint}/1.0/?x=1`;
    const matches = bodyRules().filter(({ pattern }) =>
      new RegExp(pattern, "u").test(url),
    );
    assert.equal(
      matches.length,
      1,
      `${endpoint} matched ${matches.length} rules`,
    );
  }
});

test("endpoint dots are literal rather than wildcard matches", () => {
  const valid =
    "https://acs.m.goofish.com/gw/mtop.taobao.idle.local.home/1.0/";
  const invalid =
    "https://acs.m.goofish.com/gw/mtopXtaobaoXidleXlocalXhome/1.0/";
  const rule = bodyRules().find(({ pattern }) =>
    pattern.includes("idle\\.local\\.home"),
  );
  assert.ok(rule);
  assert.equal(new RegExp(rule.pattern, "u").test(valid), true);
  assert.equal(new RegExp(rule.pattern, "u").test(invalid), false);
});

test("AMDC keeps upstream matches and supports the literal Goofish UA", () => {
  assert.deepEqual(runAmdc("AMap/1.0"), { body: "ddgksf2013" });
  assert.deepEqual(runAmdc("%E9%97%B2%E9%B1%BC/7.0"), {
    body: "ddgksf2013",
  });
  assert.deepEqual(runAmdc("闲鱼/7.0"), { body: "ddgksf2013" });
  assert.deepEqual(
    runAmdc("%E9%A3%9E%E7%8C%AA%E6%97%85%E8%A1%8C/1.0"),
    { body: "ddgksf2013" },
  );
  assert.deepEqual(runAmdc("Safari/18.0"), {});
  assert.deepEqual(runAmdc(undefined), {});
});

test(
  "home feed filter keeps the first top item without creating null",
  { skip: !jqAvailable },
  () => {
    const filter = filterFor("mtop.taobao.idlehome.home.nextfresh");
    assert.deepEqual(
      runJq(filter, {
        data: {
          homeTopList: [],
          sections: [
            { data: { bizType: "item" }, id: 1 },
            { data: { bizType: "ad" }, id: 2 },
          ],
        },
      }),
      {
        data: {
          homeTopList: [],
          sections: [{ data: { bizType: "item" }, id: 1 }],
        },
      },
    );
    assert.deepEqual(runJq(filter, { data: {} }), { data: {} });
  },
);

test(
  "guarded list filters preserve malformed or missing fields",
  { skip: !jqAvailable },
  () => {
    for (const endpoint of [
      "mtop.taobao.idlehome.home.circle.list",
      "mtop.taobao.idle.local.home",
      "mtop.taobao.idlemtopsearch.search",
      "mtop.taobao.idle.item.recommend",
    ]) {
      assert.deepEqual(runJq(filterFor(endpoint), { data: {} }), { data: {} });
    }
  },
);

test(
  "my-page filter tolerates non-string section codes",
  { skip: !jqAvailable },
  () => {
    const result = runJq(filterFor("mtop.idle.user.page.my.adapter"), {
      data: {
        ability: [1],
        container: {
          sections: [
            { sectionBizCode: "head" },
            { sectionBizCode: "userCard" },
            { sectionBizCode: "recommend" },
            { sectionBizCode: null },
          ],
        },
      },
    });
    assert.deepEqual(result.data.ability, []);
    assert.deepEqual(result.data.container.sections, [
      { sectionBizCode: "head" },
      { sectionBizCode: "userCard" },
    ]);
  },
);

test(
  "ad filters retain normal items and remove only the original targets",
  { skip: !jqAvailable },
  () => {
    const searchResult = runJq(
      filterFor("mtop.taobao.idlemtopsearch.search"),
      {
        data: {
          resultList: [
            {
              id: 1,
              data: { item: { main: { clickParam: { args: { biz_type: "item" } } } } },
            },
            {
              id: 2,
              data: { item: { main: { clickParam: { args: { biz_type: "ad" } } } } },
            },
          ],
        },
      },
    );
    assert.deepEqual(searchResult.data.resultList.map(({ id }) => id), [1]);

    const recommendResult = runJq(
      filterFor("mtop.taobao.idle.item.recommend"),
      {
        data: {
          cardList: [
            { id: 1, cardData: { bizType: "item" } },
            { id: 2, cardData: { bizType: "mamaAD" } },
            { id: 3 },
          ],
        },
      },
    );
    assert.deepEqual(recommendResult.data.cardList.map(({ id }) => id), [1, 3]);
  },
);

test(
  "the remaining original rewrite effects are unchanged",
  { skip: !jqAvailable },
  () => {
    assert.deepEqual(
      runJq(filterFor("mtop.taobao.idle.user.strategy.list"), {
        data: { strategies: [{ id: 1 }], keep: true },
      }),
      { data: { strategies: [{}], keep: true } },
    );
    assert.deepEqual(
      runJq(filterFor("mtop.taobao.idlehome.home.circle.list"), {
        data: {
          circleList: [
            { bizCode: "saveMoney", id: 1 },
            { bizCode: "normal", id: 2 },
          ],
        },
      }),
      { data: { circleList: [{ bizCode: "normal", id: 2 }] } },
    );
    assert.deepEqual(
      runJq(filterFor("mtop.taobao.idlemtopsearch.search.shade"), {
        data: { singleShadeWords: ["ad"] },
      }),
      { data: { singleShadeWords: [{}] } },
    );
    assert.deepEqual(
      runJq(filterFor("mtop.taobao.idlemtopsearch.item.search.activate"), {
        data: { cardList: [{ id: 1 }] },
      }),
      { data: { cardList: [{}] } },
    );
    assert.deepEqual(
      runJq(filterFor("mtop.taobao.idlemtopsearch.search.discover"), {
        data: { resultList: [{ id: 1 }], keep: true },
      }),
      { data: { keep: true } },
    );
    assert.deepEqual(
      runJq(filterFor("mtop.taobao.idle.item.buy.feeds"), {
        data: { sections: [{ id: 1 }], keep: true },
      }),
      { data: { keep: true } },
    );
    assert.deepEqual(
      runJq(filterFor("mtop.taobao.idle.local.home"), {
        data: {
          sections: [
            { id: 1, data: { bizType: "item" } },
            { id: 2, data: { bizType: "ad" } },
          ],
        },
      }),
      { data: { sections: [{ id: 1, data: { bizType: "item" } }] } },
    );
  },
);

function section(name) {
  const marker = `[${name}]`;
  const markerIndex = moduleText.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing ${marker} section`);
  const contentStart = markerIndex + marker.length;
  const nextSection = moduleText.indexOf("\n[", contentStart);
  return moduleText.slice(
    contentStart,
    nextSection === -1 ? moduleText.length : nextSection,
  );
}

function bodyRules() {
  return section("Body Rewrite")
    .split("\n")
    .filter((line) => line.startsWith("http-response-jq "))
    .map((line) => {
      const match = line.match(/^http-response-jq\s+(.+?)\s+'(.+)'$/u);
      assert.ok(match, `Unable to parse Body Rewrite rule: ${line}`);
      return { pattern: match[1], filter: match[2] };
    });
}

function filterFor(endpoint) {
  const matches = bodyRules().filter(({ pattern }) =>
    pattern
      .replaceAll("\\", "")
      .includes(`${endpoint}(?:/|?|$)`),
  );
  assert.equal(matches.length, 1, `Expected one jq rule for ${endpoint}`);
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

function runAmdc(userAgent) {
  let output;
  const headers =
    userAgent === undefined ? {} : { "User-Agent": userAgent };
  vm.runInNewContext(scriptText, {
    $request: { headers },
    $done: (value) => {
      output = value;
    },
  });
  return JSON.parse(JSON.stringify(output));
}
