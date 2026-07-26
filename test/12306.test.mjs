import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const moduleText = await readFile(
  new URL("../modules/ad/12306.sgmodule", import.meta.url),
  "utf8",
);
const convertedText = await readFile(
  new URL("../converted/ad/12306/script-hub.sgmodule", import.meta.url),
  "utf8",
);
const upstreamScript = await readFile(
  new URL("../upstream/ad/12306/12306.js", import.meta.url),
  "utf8",
);
const optimizedScript = await readFile(
  new URL("../scripts/ad/12306/12306.js", import.meta.url),
  "utf8",
);

const placementCases = [
  "0007",
  7,
  ["0007"],
  "G0054",
  "unknown",
  null,
  undefined,
];

test("keeps the Script Hub conversion of the embedded QX rewrite", () => {
  assert.match(convertedText, /^#!name=local$/mu);
  assert.match(convertedText, /^DOMAIN,ad\.12306\.cn,DIRECT$/mu);
  assert.match(
    convertedText,
    /^12306 = type=http-request, .*requires-body=true, max-size=-1, timeout=60$/mu,
  );
  assert.match(
    convertedText,
    /^hostname = %APPEND% ad\.12306\.cn$/mu,
  );
});

test("published module preserves converted routing and request semantics", () => {
  assert.equal(
    section(moduleText, "Rule").trim(),
    section(convertedText, "Rule").trim(),
  );
  assert.equal(
    section(moduleText, "MITM").trim(),
    section(convertedText, "MITM").trim(),
  );

  const script = scriptLine(moduleText);
  assert.match(script, /type=http-request/u);
  assert.match(script, /requires-body=true, max-size=-1, timeout=60$/u);
  assert.match(
    script,
    /AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\/12306\/12306\.js/u,
  );
});

test("published request pattern covers only the original endpoint", () => {
  const patternText = scriptLine(moduleText).match(
    /pattern=(.+?), script-path=/u,
  )?.[1];
  assert.ok(patternText);
  const pattern = new RegExp(patternText, "u");
  assert.equal(
    pattern.test("https://ad.12306.cn/ad/ser/getAdList"),
    true,
  );
  assert.equal(
    pattern.test("http://ad.12306.cn/ad/ser/getAdList?placementNo=0007"),
    true,
  );
  assert.equal(pattern.test("https://ad.12306.cn/ad/ser/other"), false);
  assert.equal(pattern.test("https://example.com/ad/ser/getAdList"), false);
});

for (const quantumultX of [true, false]) {
  for (const placementNo of placementCases) {
    test(
      `preserves ${quantumultX ? "QX" : "Surge"} output for ${JSON.stringify(placementNo)}`,
      () => {
        const requestBody =
          placementNo === undefined ? "{}" : JSON.stringify({ placementNo });
        assert.deepEqual(
          runScript(optimizedScript, requestBody, quantumultX),
          runScript(upstreamScript, requestBody, quantumultX),
        );
      },
    );
  }
}

test("preserves exact response body property order", () => {
  assert.equal(
    runScript(optimizedScript, '{"placementNo":"0007"}', false).response.body,
    '{"materialsList":[{"billMaterialsId":"6491","filePath":"ddgksf2013","creativeType":1}],"advertParam":{"skipTime":1},"code":"00"}',
  );
  assert.equal(
    runScript(optimizedScript, '{"placementNo":"G0054"}', false).response.body,
    '{"code":"00","materialsList":[{}]}',
  );
  assert.equal(
    runScript(optimizedScript, '{"placementNo":"other"}', false).response.body,
    '{"code":"00","message":"无广告返回"}',
  );
});

test("keeps strict malformed-request failures", () => {
  for (const script of [upstreamScript, optimizedScript]) {
    assert.throws(
      () => runScript(script, "{", false),
      (error) => error?.name === "SyntaxError",
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

function scriptLine(text) {
  const lines = section(text, "Script")
    .split("\n")
    .filter((line) => line.startsWith("12306 ="));
  assert.equal(lines.length, 1);
  return lines[0];
}

function runScript(script, body, quantumultX) {
  let output;
  const context = {
    $request: { body },
    $done: (value) => {
      output = value;
    },
  };
  if (quantumultX) {
    context.$task = {};
  }
  vm.runInNewContext(script, context, { timeout: 1_000 });
  return JSON.parse(JSON.stringify(output));
}
