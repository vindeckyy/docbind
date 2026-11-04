import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types.js";
import type { ExtractResult } from "./surface/protocol.js";
import { ENGINE_VERSION } from "./version.js";

const CACHE_DIR = ".docbind-cache";

function hashFile(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return "missing";
  }
}

export function surfaceCacheKey(root: string, files: string[], config: Config): string {
  const hash = createHash("sha256");
  hash.update(`engine:${ENGINE_VERSION}\n`);
  hash.update(`languages:${JSON.stringify(config.languages)}\n`);
  hash.update(`javadoc:${config.javadoc}\n`);
  hash.update(`javaDefaults:${config.javaDefaults}\n`);
  for (const file of [...files].sort()) {
    hash.update(`${file}:${hashFile(join(root, file))}\n`);
  }
  return hash.digest("hex");
}

function cachePath(root: string, key: string): string {
  return join(root, CACHE_DIR, "surface", `${key}.json`);
}

export function readSurfaceCache(root: string, key: string): ExtractResult | undefined {
  const path = cachePath(root, key);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ExtractResult;
  } catch {
    rmSync(path, { force: true });
    return undefined;
  }
}

export function writeSurfaceCache(root: string, key: string, result: ExtractResult): void {
  const path = cachePath(root, key);
  mkdirSync(join(root, CACHE_DIR, "surface"), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(result), "utf8");
  renameSync(temporary, path);
}

export function clearCache(root: string): void {
  rmSync(join(root, CACHE_DIR), { recursive: true, force: true });
}
