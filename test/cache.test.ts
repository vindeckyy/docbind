import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../src/check.js";
import { clearCache, readSurfaceCache, surfaceCacheKey, writeSurfaceCache } from "../src/cache.js";
import { parseConfig } from "../src/config.js";
import { tempProject } from "./helpers.js";

function project(): string {
  return tempProject({
    "package.json": JSON.stringify({ name: "app" }),
    "src/users.ts": "export function getUser(id: string): string { return id; }\n",
    "docs/api.md": "Call `getUser(id)`.\n",
  });
}

describe("surface cache", () => {
  it("reuses a cached surface and invalidates on content change", () => {
    const root = project();
    const config = parseConfig({});
    const first = checkProject(root, config);
    expect(first.stats.symbols).toBe(1);
    const key = surfaceCacheKey(root, ["src/users.ts"], config);
    const cached = readSurfaceCache(root, key);
    expect(cached?.symbols).toHaveLength(1);
    writeSurfaceCache(root, key, { ...cached!, symbols: [] });
    expect(checkProject(root, config).stats.symbols).toBe(0);
    writeFileSync(join(root, "src/users.ts"), "export function fetchUser(id: string): string { return id; }\n");
    expect(checkProject(root, config).stats.symbols).toBe(1);
    expect(readdirSync(join(root, ".docbind-cache/surface"))).toHaveLength(2);
  });

  it("ignores corrupt entries and can be disabled or cleared", () => {
    const root = project();
    const config = parseConfig({});
    const key = surfaceCacheKey(root, ["src/users.ts"], config);
    writeSurfaceCache(root, key, { symbols: [], parseFailures: 0, filesScanned: 1 });
    writeFileSync(join(root, ".docbind-cache/surface", `${key}.json`), "{");
    expect(checkProject(root, config).stats.symbols).toBe(1);
    const disabled = parseConfig({ cache: false });
    expect(checkProject(root, disabled).stats.symbols).toBe(1);
    clearCache(root);
    expect(existsSync(join(root, ".docbind-cache"))).toBe(false);
  });
});
