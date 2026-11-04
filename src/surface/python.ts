import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { findPackageRoot, modulePathFor } from "../discover.js";
import type { DocstringEntry, ExtractResult } from "./protocol.js";

function workerPath(): string {
  if (process.env.DOCBIND_PYTHON_WORKER) return process.env.DOCBIND_PYTHON_WORKER;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../python/docbind_extract.py"),
    join(here, "../python/docbind_extract.py"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function extractPython(root: string, files: string[]): ExtractResult {
  if (files.length === 0) {
    return { symbols: [], parseFailures: 0, filesScanned: 0 };
  }
  const payloadFiles = files.map((rel) => {
    const normalized = rel.replace(/\\/gu, "/");
    const packageInfo = findPackageRoot(root, normalized);
    return {
      rel: normalized,
      packageRoot: packageInfo.root,
      packageName: packageInfo.name,
      modulePath: modulePathFor(packageInfo.root, join(root, normalized)),
    };
  });
  const result = spawnSync(process.env.DOCBIND_PYTHON ?? "python3", [workerPath()], {
    input: JSON.stringify({ root, files: payloadFiles }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return {
      symbols: [],
      parseFailures: files.length,
      filesScanned: files.length,
      error: result.error?.message ?? (result.stderr || "python extractor failed").trim(),
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as ExtractResult;
    return {
      symbols: parsed.symbols ?? [],
      docstrings: (parsed.docstrings ?? []) as DocstringEntry[],
      parseFailures: parsed.parseFailures ?? 0,
      filesScanned: parsed.filesScanned ?? files.length,
    };
  } catch (error) {
    return {
      symbols: [],
      parseFailures: files.length,
      filesScanned: files.length,
      error: `invalid python extractor output: ${(error as Error).message}`,
    };
  }
}
