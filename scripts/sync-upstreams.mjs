#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  importModule,
  parseArguments,
  readRegistry,
} from "./module-tools.mjs";

export async function syncRegisteredUpstreams({
  root,
  repository,
  branch = "main",
  registry,
  importModuleImpl = importModule,
}) {
  const results = [];
  const failures = [];

  for (const entry of registry) {
    try {
      const result = await importModuleImpl({
        root,
        url: entry.moduleUrl,
        slug: entry.slug,
        category: entry.category,
        repository,
        branch,
        overwriteOptimized: false,
        publishedModuleFile: entry.moduleFile,
        upstreamModuleFile: entry.upstreamFile,
        sync: entry.sync,
        conversion: entry.conversion,
        dependencies: entry.dependencies,
      });
      results.push(result);
      console.log(
        `Synced ${result.category}/${result.slug}: ${result.scriptCount} script(s)`,
      );
    } catch (error) {
      if (!entry.sync?.retainExistingOnFailure) {
        throw error;
      }
      await verifyRetainedSnapshots(root, entry);
      const failure = {
        category: entry.category,
        slug: entry.slug,
        message: String(error?.message ?? error),
      };
      failures.push(failure);
      console.warn(
        `Retained existing snapshots for ${failure.category}/${failure.slug}: ${failure.message}`,
      );
    }
  }

  return { results, failures };
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const root = path.resolve(argumentsMap.root ?? process.cwd());
  const repository =
    argumentsMap.repository ??
    process.env.GITHUB_REPOSITORY ??
    "AWelook/Surge-Modules-Optimized";
  const branch = argumentsMap.branch ?? "main";
  const failuresFile = argumentsMap.failuresFile;
  const registry = await readRegistry(path.join(root, "registry.json"));
  const { failures } = await syncRegisteredUpstreams({
    root,
    repository,
    branch,
    registry,
  });

  if (failuresFile) {
    const resolvedFailuresFile = path.resolve(failuresFile);
    await mkdir(path.dirname(resolvedFailuresFile), { recursive: true });
    await writeFile(
      resolvedFailuresFile,
      `${JSON.stringify(failures, null, 2)}\n`,
      "utf8",
    );
  }

  console.log(
    `Upstream sync complete: ${registry.length - failures.length} synced, ` +
      `${failures.length} retained`,
  );
}

async function verifyRetainedSnapshots(root, entry) {
  const paths = [
    entry.upstreamFile,
    entry.conversion?.snapshot,
    ...(entry.scripts ?? []).map(
      ({ fileName }) =>
        `upstream/${entry.category}/${entry.slug}/${fileName}`,
    ),
    ...(entry.dependencies ?? []).map(
      ({ fileName }) =>
        `upstream/${entry.category}/${entry.slug}/${fileName}`,
    ),
  ].filter(Boolean);

  for (const configuredPath of paths) {
    const filePath = resolveManagedPath(root, configuredPath);
    try {
      await readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `Cannot retain ${entry.category}/${entry.slug}; missing ${configuredPath}`,
        );
      }
      throw error;
    }
  }
}

function resolveManagedPath(root, configuredPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(root, configuredPath);
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Managed path must stay inside the repository: ${configuredPath}`);
  }
  return resolvedPath;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
