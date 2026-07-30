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
  convertRegisteredSnapshots,
  convertWithScriptHub,
} from "../scripts/script-hub-tools.mjs";

const validConversion = `#!name=Example

[Rule]
DOMAIN,example.com,REJECT
`;

test("sends local text with percent-encoded spaces and writes the snapshot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "script-hub-convert-"));
  const upstreamPath = path.join(root, "upstream/ad/example/module.lpx");
  const source = "#!name=Example module\n[Rule]\nDOMAIN,example.com,REJECT\n";
  await mkdir(path.dirname(upstreamPath), { recursive: true });
  await writeFile(upstreamPath, source, "utf8");
  await writeFile(
    path.join(root, "registry.json"),
    `${JSON.stringify([
      {
        slug: "example",
        category: "ad",
        upstreamFile: "upstream/ad/example/module.lpx",
        conversion: {
          provider: "Script Hub",
          sourceType: "loon-plugin",
          targetType: "surge-module",
          snapshot: "converted/ad/example/script-hub.sgmodule",
          automation: { jqEnabled: true },
        },
      },
    ])}\n`,
    "utf8",
  );

  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = String(url);
    return new Response(validConversion, { status: 200 });
  };

  try {
    const converted = await convertRegisteredSnapshots({
      root,
      endpoint: "http://127.0.0.1:9100",
      fetchImpl,
    });
    assert.deepEqual(converted, [
      {
        category: "ad",
        slug: "example",
        snapshot: "converted/ad/example/script-hub.sgmodule",
      },
    ]);
    assert.match(requestedUrl, /jqEnabled=true/u);
    assert.match(requestedUrl, /Example%20module/u);
    assert.doesNotMatch(requestedUrl, /Example\+module/u);
    assert.equal(
      await readFile(
        path.join(root, "converted/ad/example/script-hub.sgmodule"),
        "utf8",
      ),
      validConversion,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed Script Hub output before writing", async () => {
  await assert.rejects(
    convertWithScriptHub({
      endpoint: "http://127.0.0.1:9100",
      source: "#!name=Example",
      fileName: "example.sgmodule",
      sourceType: "loon-plugin",
      targetType: "surge-module",
      fetchImpl: async () =>
        new Response("#!error=conversion failed\n", { status: 200 }),
    }),
    /missing #!name|conversion error/u,
  );
});

test("rejects paths outside the repository", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "script-hub-path-"));
  await writeFile(
    path.join(root, "registry.json"),
    `${JSON.stringify([
      {
        slug: "example",
        category: "ad",
        upstreamFile: "../outside.lpx",
        conversion: {
          sourceType: "loon-plugin",
          targetType: "surge-module",
          snapshot: "converted/ad/example/script-hub.sgmodule",
          automation: { jqEnabled: true },
        },
      },
    ])}\n`,
    "utf8",
  );

  try {
    await assert.rejects(
      convertRegisteredSnapshots({
        root,
        endpoint: "http://127.0.0.1:9100",
      }),
      /must stay inside/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
