import { describe, expect, it } from "vitest";
import {
  inferRename,
  modulePathFromId,
  nameSimilarity,
  parseShapeText,
} from "../src/resolve/rename.js";
import { matchTombstone } from "../src/resolve/tombstone.js";
import type { DocAnchor, Shape, Symbol, Tombstone } from "../src/types.js";

const shape: Shape = { kind: "function", params: [], returnType: "User" };
const shapeText = JSON.stringify(shape);

function symbol(name: string, over: Partial<Symbol> = {}): Symbol {
  return {
    id: `app|src/users|function|${name}|0`,
    name,
    kind: "function",
    modulePath: "src/users",
    packageName: "app",
    packageRoot: "/app",
    qualifiedName: `app.src.users.${name}`,
    aliases: [],
    shape,
    shapeText,
    shapeHash: "h",
    paramNamesHash: "p",
    bodyHash: "body",
    contractFlags: [],
    line: 1,
    filePath: "src/users.ts",
    ...over,
  };
}

function anchor(token: string): DocAnchor {
  return {
    docPath: "docs/api.md",
    line: 1,
    column: 1,
    length: token.length,
    token,
    occurrence: 0,
    surface: "inlineCode",
    contextFp: "ctx",
    importTable: {},
    localDecls: [],
    fragment: false,
  };
}

function tombstone(over: Partial<Tombstone> = {}): Tombstone {
  return {
    symbolId: "app|src/users|function|getUser|0",
    name: "getUser",
    qualifiedName: "app.src.users.getUser",
    kind: "function",
    shapeHash: "h",
    shape: shapeText,
    bodyHash: "body",
    removedInGeneration: 1,
    ...over,
  };
}

describe("renames", () => {
  it("computes normalized name similarity", () => {
    expect(nameSimilarity("getUser", "getUser")).toBe(1);
    expect(nameSimilarity("getUser", "get_user")).toBeGreaterThan(0.8);
    expect(nameSimilarity("getUser", "totallyDifferent")).toBeLessThan(0.3);
  });

  it("infers a rename with identical shape and body", () => {
    const result = inferRename(
      { name: "getUser", kind: "function", shapeText, bodyHash: "body", modulePath: "src/users" },
      [symbol("get_user")],
    );
    expect(result?.symbol.name).toBe("get_user");
    expect(result?.score).toBeGreaterThanOrEqual(0.8);
  });

  it("sorts ties and handles empty body hashes", () => {
    const base = { name: "getUser", kind: "function" as const, shapeText, bodyHash: "body", modulePath: "src/users" };
    const result = inferRename(base, [
      symbol("get_user", { id: "b" }),
      symbol("get_user", { id: "a" }),
    ]);
    expect(result?.symbol.id).toBe("a");
    expect(inferRename({ ...base, bodyHash: "" }, [symbol("get_user", { bodyHash: "" })])).toBeUndefined();
  });

  it("rejects weak candidates", () => {
    const base = { name: "getUser", kind: "function" as const, shapeText, bodyHash: "body", modulePath: "src/users" };
    expect(inferRename(base, [symbol("get_user", { bodyHash: "other" })])).toBeUndefined();
    expect(inferRename(base, [symbol("get_user", { shapeText: '{"kind":"class"}' })])).toBeUndefined();
    expect(inferRename(base, [])).toBeUndefined();
    expect(inferRename(base, [symbol("other", { kind: "class" })])).toBeUndefined();
  });

  it("parses lock shape text defensively", () => {
    expect(parseShapeText(shapeText)).toEqual(shape);
    expect(parseShapeText("{")).toEqual({ kind: "function" });
    expect(parseShapeText("null")).toEqual({ kind: "function" });
    expect(modulePathFromId("app|src/users|function|getUser|0")).toBe("src/users");
    expect(modulePathFromId("x")).toBe("");
    expect(parseShapeText("{}")).toEqual({ kind: "function" });
  });
});

describe("tombstones", () => {
  it("matches names, qualified names and suffixes", () => {
    expect(matchTombstone(anchor("getUser"), [tombstone()])?.name).toBe("getUser");
    expect(matchTombstone(anchor("app.src.users.getUser"), [tombstone()])?.name).toBe("getUser");
    expect(matchTombstone(anchor("users.getUser"), [tombstone()])?.name).toBe("getUser");
  });

  it("stays silent for no match or ambiguity", () => {
    expect(matchTombstone(anchor("other"), [tombstone()])).toBeUndefined();
    expect(matchTombstone(anchor("getUser"), [
      tombstone(),
      tombstone({ symbolId: "app|src/other|function|getUser|0", qualifiedName: "app.src.other.getUser" }),
    ])).toBeUndefined();
  });
});
