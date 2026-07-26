import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const modulePath = new URL("../modules/ad/goofish-ads.conf", import.meta.url);
const scriptPath = new URL(
  "../scripts/ad/goofish-ads/amdc.js",
  import.meta.url,
);
const moduleText = await readFile(modulePath, "utf8");
const scriptText = await readFile(scriptPath, "utf8");
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;

test("published module uses the repository AMDC script", () => {
  assert.match(
    moduleText,
    /AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\/goofish-ads\/amdc\.js/u,
  );
  assert.doesNotMatch(
    moduleText,
    /script-response-body https:\/\/raw\.githubusercontent\.com\/ddgksf2013/u,
  );
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
      "mtop.taobao.idlemtopsearch.search url",
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

function filterFor(endpoint) {
  const line = moduleText
    .split("\n")
    .find(
      (candidate) =>
        candidate.includes(endpoint) &&
        candidate.includes("jsonjq-response-body"),
    );
  assert.ok(line, `Missing jq rule for ${endpoint}`);
  const match = line.match(/jsonjq-response-body '(.+)'$/u);
  assert.ok(match, `Unable to parse jq rule for ${endpoint}`);
  return match[1];
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
  vm.runInNewContext(scriptText, {
    $request: { headers: { "User-Agent": userAgent } },
    $done: (value) => {
      output = value;
    },
  });
  return JSON.parse(JSON.stringify(output));
}
