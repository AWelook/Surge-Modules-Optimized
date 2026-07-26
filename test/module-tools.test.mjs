import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

test("allows the explicitly supported Kelee upstream host", () => {
  assert.doesNotThrow(() =>
    validateRemoteUrl(
      "https://kelee.one/Tool/Loon/Lpx/example.lpx",
      "module URL",
    ),
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

test("preserves a Quantumult X conf extension", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "surge-conf-import-"));
  const originalFetch = globalThis.fetch;
  const moduleUrl =
    "https://raw.githubusercontent.com/source/repo/main/example.conf";
  globalThis.fetch = async () =>
    new Response("hostname = example.com\n", { status: 200 });

  try {
    await importModule({
      root,
      url: moduleUrl,
      slug: "example",
      category: "ad",
      repository: "AWelook/Surge-Modules-Optimized",
    });
    assert.equal(
      await readFile(path.join(root, "modules/ad/example.conf"), "utf8"),
      "hostname = example.com\n",
    );
    assert.equal(
      await readFile(path.join(root, "upstream/ad/example/module.conf"), "utf8"),
      "hostname = example.com\n",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves a Quantumult X snippet extension", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "surge-snippet-import-"));
  const originalFetch = globalThis.fetch;
  const moduleUrl =
    "https://raw.githubusercontent.com/source/repo/main/example.snippet";
  globalThis.fetch = async () =>
    new Response("hostname = example.com\n", { status: 200 });

  try {
    await importModule({
      root,
      url: moduleUrl,
      slug: "example",
      category: "ad",
      repository: "AWelook/Surge-Modules-Optimized",
    });
    assert.equal(
      await readFile(path.join(root, "modules/ad/example.snippet"), "utf8"),
      "hostname = example.com\n",
    );
    assert.equal(
      await readFile(
        path.join(root, "upstream/ad/example/module.snippet"),
        "utf8",
      ),
      "hostname = example.com\n",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("imports and tracks indirect JavaScript dependencies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "surge-dependency-import-"));
  const originalFetch = globalThis.fetch;
  const moduleUrl =
    "https://raw.githubusercontent.com/source/repo/main/example.sgmodule";
  const scriptUrl =
    "https://raw.githubusercontent.com/source/repo/main/main.js";
  const dependencyUrl =
    "https://raw.githubusercontent.com/source/repo/main/chunk.js";
  globalThis.fetch = async (url) => {
    const source = new Map([
      [
        moduleUrl,
        `[Script]\nmain = type=http-response, script-path=${scriptUrl}\n`,
      ],
      [scriptUrl, `const chunk = "${dependencyUrl}";\n`],
      [dependencyUrl, "const dependency = true;\n"],
    ]).get(String(url));
    return source === undefined
      ? new Response("not found", { status: 404 })
      : new Response(source, { status: 200 });
  };

  try {
    const result = await importModule({
      root,
      url: moduleUrl,
      slug: "example",
      category: "ad",
      repository: "AWelook/Surge-Modules-Optimized",
      dependencies: [{ url: dependencyUrl, fileName: "chunk.js" }],
    });
    assert.equal(result.scriptCount, 2);
    assert.equal(
      await readFile(
        path.join(root, "upstream/ad/example/chunk.js"),
        "utf8",
      ),
      "const dependency = true;\n",
    );
    assert.equal(
      await readFile(path.join(root, "scripts/ad/example/chunk.js"), "utf8"),
      "const dependency = true;\n",
    );
    const registry = JSON.parse(
      await readFile(path.join(root, "registry.json"), "utf8"),
    );
    assert.deepEqual(registry[0].dependencies, [
      { url: dependencyUrl, fileName: "chunk.js" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("sync preserves registered converted module paths and metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "surge-converted-sync-"));
  const originalFetch = globalThis.fetch;
  const moduleUrl =
    "https://raw.githubusercontent.com/source/repo/main/example.conf";
  const optimizedPath = path.join(root, "modules/ad/example.sgmodule");
  const conversion = {
    provider: "Script Hub",
    sourceType: "qx-rewrite",
    targetType: "surge-module",
    snapshot: "converted/ad/example/script-hub.sgmodule",
  };
  globalThis.fetch = async () =>
    new Response("hostname = example.com\n", { status: 200 });

  try {
    await mkdir(path.dirname(optimizedPath), { recursive: true });
    await writeFile(optimizedPath, "#!name=optimized\n", "utf8");
    await importModule({
      root,
      url: moduleUrl,
      slug: "example",
      category: "ad",
      repository: "AWelook/Surge-Modules-Optimized",
      publishedModuleFile: "modules/ad/example.sgmodule",
      upstreamModuleFile: "upstream/ad/example/module.conf",
      conversion,
    });
    assert.equal(await readFile(optimizedPath, "utf8"), "#!name=optimized\n");
    const registry = JSON.parse(
      await readFile(path.join(root, "registry.json"), "utf8"),
    );
    assert.equal(registry[0].moduleFile, "modules/ad/example.sgmodule");
    assert.deepEqual(registry[0].conversion, conversion);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
