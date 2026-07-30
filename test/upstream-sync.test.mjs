import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncRegisteredUpstreams } from "../scripts/sync-upstreams.mjs";

test("retains complete registered snapshots after an allowed sync failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "upstream-retain-"));
  const entry = {
    slug: "example",
    category: "ad",
    moduleUrl: "https://kelee.one/example.lpx",
    upstreamFile: "upstream/ad/example/module.lpx",
    sync: { retainExistingOnFailure: true },
    conversion: {
      snapshot: "converted/ad/example/script-hub.sgmodule",
    },
    scripts: [{ fileName: "main.js" }],
    dependencies: [{ fileName: "chunk.js" }],
  };
  const requiredFiles = [
    entry.upstreamFile,
    entry.conversion.snapshot,
    "upstream/ad/example/main.js",
    "upstream/ad/example/chunk.js",
  ];
  for (const relativePath of requiredFiles) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "existing\n", "utf8");
  }

  try {
    const result = await syncRegisteredUpstreams({
      root,
      repository: "AWelook/Surge-Modules-Optimized",
      registry: [entry],
      importModuleImpl: async () => {
        throw new Error("Unable to download module: HTTP 403");
      },
    });
    assert.deepEqual(result.results, []);
    assert.deepEqual(result.failures, [
      {
        category: "ad",
        slug: "example",
        message: "Unable to download module: HTTP 403",
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when a retained snapshot is incomplete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "upstream-incomplete-"));
  const entry = {
    slug: "example",
    category: "ad",
    moduleUrl: "https://kelee.one/example.lpx",
    upstreamFile: "upstream/ad/example/module.lpx",
    sync: { retainExistingOnFailure: true },
    scripts: [{ fileName: "missing.js" }],
  };
  const upstreamPath = path.join(root, entry.upstreamFile);
  await mkdir(path.dirname(upstreamPath), { recursive: true });
  await writeFile(upstreamPath, "existing\n", "utf8");

  try {
    await assert.rejects(
      syncRegisteredUpstreams({
        root,
        repository: "AWelook/Surge-Modules-Optimized",
        registry: [entry],
        importModuleImpl: async () => {
          throw new Error("Unable to download module: HTTP 403");
        },
      }),
      /missing upstream\/ad\/example\/missing\.js/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not retain failures for projects without an explicit policy", async () => {
  await assert.rejects(
    syncRegisteredUpstreams({
      root: process.cwd(),
      repository: "AWelook/Surge-Modules-Optimized",
      registry: [
        {
          slug: "example",
          category: "ad",
          moduleUrl:
            "https://raw.githubusercontent.com/source/repo/main/example.sgmodule",
        },
      ],
      importModuleImpl: async () => {
        throw new Error("network failed");
      },
    }),
    /network failed/u,
  );
});
