import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { checkProject } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { extractLsif } from "../src/surface/lsif.js";
import { tempProject } from "./helpers.js";

const index = join(import.meta.dirname, "fixtures/lsif/index.lsif");

describe("LSIF ingestion", () => {
  it("creates index-only symbols from export monikers", () => {
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    const result = extractLsif(root, [index]);
    expect(result.error).toBeUndefined();
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0]).toMatchObject({
      name: "getUser",
      filePath: "src/users.ts",
      qualifiedName: "app.src.users.getUser",
      indexOnly: true,
    });
  });

  it("binds explicit annotations through an index", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export const other = 1;\n",
      "docs/api.md": "<!-- docbind: symbol=src/users.ts#getUser -->\n\nCall `getUser(id)`.\n",
    });
    const config = parseConfig({ indexes: [index] });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.indexOnly).toBe(true);
    expect(result.stats.symbols).toBe(2);
    expect(checkProject(root, parseConfig({})).findings[0]?.rule).toBe("L1-broken");
  });

  it("warns on unreadable indexes", () => {
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    const result = checkProject(root, parseConfig({ indexes: ["missing.lsif"] }));
    expect(result.warnings[0]).toContain("LSIF index unreadable");
  });
});
