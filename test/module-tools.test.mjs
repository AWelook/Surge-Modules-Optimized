import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discoverScriptUrls,
  importModule,
  parseArguments,
  validateRemoteUrl,
} from "../scripts/module-tools.mjs";

test("discovers and deduplicates Surge script paths", () => {
  const moduleText = `
[Script]
one = type=http-response, script-path=https://raw.githubusercontent.com/a/b/main/a.js, requires-body=true
two = type=http-response, script-path=https://raw.githubusercontent.com/a/b/main/a.js, requires-body=true
three = type=http-response, script-path=https://raw.githubusercontent.com/a/b/main/b.js?raw=1, requires-body=true
`;
  assert.deepEqual(discoverScriptUrls(moduleText), [
    "https://raw.githubusercontent.com/a/b/main/a.js",
    "https://raw.githubusercontent.com/a/b/main/b.js?raw=1",
  ]);
});

test("parses flags and values", () => {
  assert.deepEqual(
    { ...parseArguments(["--slug", "tieba", "--overwrite-optimized"]) },
    { slug: "tieba", overwriteOptimized: true },
  );
});

test("rejects non-GitHub download hosts", () => {
  assert.throws(
    () => validateRemoteUrl("https://example.com/script.js", "script URL"),
    /approved GitHub content host/u,
  );
});

test("imports a module, preserves upstream files, and rewrites script URLs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "surge-module-import-"));
  const originalFetch = globalThis.fetch;
  const moduleUrl =
    "https://raw.githubusercontent.com/source/repo/main/tieba.sgmodule";
  const jsonUrl =
    "https://raw.githubusercontent.com/source/repo/main/tieba-json.js";
  const protoUrl =
    "https://raw.githubusercontent.com/source/repo/main/tieba-proto.js";
  const moduleText = `[Script]
json = type=http-response, script-path=${jsonUrl}, requires-body=true
proto = type=http-response, script-path=${protoUrl}, requires-body=true
`;
  const sources = new Map([
    [moduleUrl, moduleText],
    [jsonUrl, "const json = true;\n"],
    [protoUrl, "const proto = true;\n"],
  ]);

  globalThis.fetch = async (url) => {
    const source = sources.get(String(url));
    return source === undefined
      ? new Response("not found", { status: 404 })
      : new Response(source, {
          status: 200,
          headers: { "content-length": String(Buffer.byteLength(source)) },
        });
  };

  try {
    const result = await importModule({
      root,
      url: moduleUrl,
      slug: "tieba",
      category: "ad",
      repository: "AWelook/Surge-Modules-Optimized",
    });
    assert.equal(result.scriptCount, 2);
    assert.equal(
      await readFile(
        path.join(root, "upstream/ad/tieba/tieba-json.js"),
        "utf8",
      ),
      "const json = true;\n",
    );
    assert.equal(
      await readFile(
        path.join(root, "scripts/ad/tieba/tieba-proto.js"),
        "utf8",
      ),
      "const proto = true;\n",
    );
    const publishedModule = await readFile(
      path.join(root, "modules/ad/tieba.sgmodule"),
      "utf8",
    );
    assert.match(
      publishedModule,
      /AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\/tieba\/tieba-json\.js/u,
    );
    assert.doesNotMatch(publishedModule, /source\/repo/u);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
