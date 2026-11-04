import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { applyAnnotations, suggestAnnotations, type Adoption } from "../src/adopt.js";
import { parseConfig } from "../src/config.js";
import { tempProject } from "./helpers.js";

const code = `export function getUser(id: string): string { return id; }\n`;

function adoption(over: Partial<Adoption> = {}): Adoption {
  return {
    docPath: "docs/api.md",
    line: 2,
    column: 1,
    token: "getUser",
    symbolId: "id",
    confidence: 0.7,
    annotation: "<!-- docbind: symbol=src/users.ts#getUser -->",
    ...over,
  };
}

describe("adopt", () => {
  it("suggests annotations for inferred bindings only", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": code,
      "docs/api.md": "Call `getUser(id)`.\n",
    });
    const suggestions = suggestAnnotations(root, parseConfig({}));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.annotation).toContain("symbol=src/users.ts#getUser");
    expect(suggestions[0]?.annotation).toContain("adopted confidence=");
    expect(suggestions[0]?.confidence).toBeGreaterThan(0);
  });

  it("does not suggest when an explicit annotation already covers the symbol", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": code,
      "docs/api.md": "<!-- docbind: symbol=src/users.ts#getUser -->\nCall `getUser(id)`.\n",
    });
    expect(suggestAnnotations(root, parseConfig({}))).toEqual([]);
  });

  it("dedupes repeated tokens and sorts across files", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export function getUser(id: string): string { return id; }\n",
      "docs/z.md": "Call `getUser(id)` and `getUser(id)`.\n",
      "docs/a.md": "Call `getUser(id)`.\n",
    });
    const suggestions = suggestAnnotations(root, parseConfig({}));
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((suggestion) => suggestion.docPath)).toEqual(["docs/a.md", "docs/z.md"]);
  });

  it("inserts once, skips existing annotations, and ignores out-of-range lines", () => {
    const root = tempProject({
      "docs/api.md": "<!-- docbind: symbol=src/users.ts#getUser -->\nCall `getUser`.\n",
    });
    const applied = applyAnnotations(root, [
      adoption(),
      adoption(),
      adoption({ line: 999 }),
    ]);
    expect(applied.inserted).toBe(0);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toContain("<!-- docbind: symbol=src/users.ts#getUser -->");
  });

  it("inserts multiple annotations with indentation", () => {
    const root = tempProject({ "docs/api.md": "  Call `getUser` and `other`.\n" });
    const applied = applyAnnotations(root, [
      adoption({ line: 1, annotation: "<!-- docbind: symbol=src/users.ts#getUser -->" }),
      adoption({ line: 1, annotation: "<!-- docbind: symbol=src/users.ts#other -->" }),
    ]);
    expect(applied.inserted).toBe(2);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toBe(
      "  <!-- docbind: symbol=src/users.ts#getUser -->\n  <!-- docbind: symbol=src/users.ts#other -->\n  Call `getUser` and `other`.\n",
    );
  });
});
