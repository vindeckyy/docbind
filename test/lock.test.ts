import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emptyLock,
  entryFromBinding,
  lockContentEqual,
  lockPath,
  parseLock,
  readLock,
  serializeLock,
  sortLock,
  tombstoneFromSymbol,
  writeLock,
} from "../src/lock/schema.js";
import { entryKey, mergeEntries, mergeTombstones, nextGeneration } from "../src/lock/merge.js";
import * as readModule from "../src/lock/read.js";
import * as writeModule from "../src/lock/write.js";
import type { Binding, DocAnchor, LockEntry, Shape, Symbol, Tombstone } from "../src/types.js";
import { emptyProject, tempProject } from "./helpers.js";

const shape: Shape = { kind: "function", params: [] };

function symbol(over: Partial<Symbol> = {}): Symbol {
  return {
    id: "app|src/users|function|getUser|0",
    name: "getUser",
    kind: "function",
    modulePath: "src/users",
    packageName: "app",
    packageRoot: "/app",
    qualifiedName: "app.src.users.getUser",
    aliases: [],
    shape,
    shapeText: JSON.stringify(shape),
    shapeHash: "shape",
    paramNamesHash: "names",
    bodyHash: "body",
    contractFlags: [],
    line: 2,
    filePath: "src/users.ts",
    ...over,
  };
}

function anchor(over: Partial<DocAnchor> = {}): DocAnchor {
  return {
    docPath: "docs/api.md",
    line: 3,
    column: 7,
    length: 7,
    token: "getUser",
    occurrence: 0,
    surface: "inlineCode",
    contextFp: "ctx",
    importTable: {},
    localDecls: [],
    fragment: false,
    ...over,
  };
}

function binding(): Binding {
  return { anchor: anchor(), symbol: symbol(), score: 0.9, evidence: ["exported name"] };
}

function entry(over: Partial<LockEntry> = {}): LockEntry {
  return {
    docPath: "docs/api.md",
    contextFp: "ctx",
    token: "getUser",
    occurrence: 0,
    symbolId: "app|src/users|function|getUser|0",
    name: "getUser",
    qualifiedName: "app.src.users.getUser",
    kind: "function",
    shapeHash: "shape",
    shape: JSON.stringify(shape),
    paramNamesHash: "names",
    bodyHash: "body",
    confidence: 0.9,
    ...over,
  };
}

describe("lock files", () => {
  it("creates and sorts a lock", () => {
    const lock = {
      ...emptyLock(),
      anchors: [entry({ token: "b" }), entry({ token: "a" }), entry({ docPath: "a.md" })],
      tombstones: [
        { ...tombstoneFromSymbol(symbol(), 1), symbolId: "z" },
        { ...tombstoneFromSymbol(symbol(), 1), symbolId: "a" },
      ],
    };
    const sorted = sortLock(lock);
    expect(sorted.anchors[0].docPath).toBe("a.md");
    expect(sorted.tombstones.map((tombstone) => tombstone.symbolId)).toEqual(["a", "z"]);
    expect(serializeLock(sorted).endsWith("\n")).toBe(true);
  });

  it("round-trips and validates", () => {
    const lock = { ...emptyLock(), anchors: [entry()], generation: 4 };
    expect(parseLock(JSON.parse(serializeLock(lock)))).toEqual(sortLock(lock));
    expect(() => parseLock({ ...lock, schema: 2 })).toThrow();
    expect(() => parseLock({ ...lock, anchors: [{}] })).toThrow();
  });

  it("reads and writes", () => {
    const root = emptyProject();
    expect(readLock(root)).toEqual(emptyLock());
    const lock = { ...emptyLock(), anchors: [entry()], generation: 2 };
    writeLock(root, lock);
    expect(JSON.parse(readFileSync(lockPath(root), "utf8")).generation).toBe(2);
    expect(readLock(root)).toEqual(sortLock(lock));
    expect(readModule.readLock(root)).toEqual(sortLock(lock));
    writeModule.writeLock(root, lock);
  });

  it("throws on malformed lock and non-ENOENT read failures", () => {
    const malformed = tempProject({ "docbind.lock.json": "{" });
    expect(() => readLock(malformed)).toThrow();
    const directory = tempProject({ "docbind.lock.json/x": "x" });
    expect(() => readLock(directory)).toThrow();
  });

  it("derives entries and tombstones", () => {
    const derived = entryFromBinding(binding());
    expect(derived).toMatchObject({ symbolId: symbol().id, token: "getUser", confidence: 0.9 });
    const grave = tombstoneFromSymbol(symbol(), 3);
    expect(grave).toMatchObject({ removedInGeneration: 3, symbolId: symbol().id });
    expect(tombstoneFromSymbol(symbol(), 3, "new").renamedTo).toBe("new");
  });

  it("sorts entries by every key component", () => {
    const lock = {
      ...emptyLock(),
      anchors: [
        entry({ docPath: "b.md", contextFp: "a", token: "a", occurrence: 0 }),
        entry({ docPath: "a.md", contextFp: "b", token: "a", occurrence: 0 }),
        entry({ docPath: "a.md", contextFp: "a", token: "b", occurrence: 0 }),
        entry({ docPath: "a.md", contextFp: "a", token: "a", occurrence: 1 }),
        entry({ docPath: "a.md", contextFp: "a", token: "a", occurrence: 0 }),
      ],
    };
    expect(sortLock(lock).anchors.map((anchor) => `${anchor.docPath}:${anchor.contextFp}:${anchor.token}:${anchor.occurrence}`)).toEqual([
      "a.md:a:a:0", "a.md:a:a:1", "a.md:a:b:0", "a.md:b:a:0", "b.md:a:a:0",
    ]);
  });

  it("compares content without generation or engine", () => {
    const left = { ...emptyLock(), anchors: [entry()], generation: 1, engine: "a" };
    const right = { ...emptyLock(), anchors: [entry()], generation: 9, engine: "b" };
    expect(lockContentEqual(left, right)).toBe(true);
    expect(lockContentEqual(left, { ...right, anchors: [] })).toBe(false);
  });
});

describe("lock merging", () => {
  it("keys entries and merges bindings", () => {
    expect(entryKey(entry())).toContain("docs/api.md");
    const merged = mergeEntries([entry({ token: "old" })], [binding()]);
    expect(merged).toHaveLength(2);
    const replaced = mergeEntries([entry()], [binding()]);
    expect(replaced).toHaveLength(1);
  });

  it("prunes old tombstones but keeps referenced ones", () => {
    const old = { ...tombstoneFromSymbol(symbol(), 1), symbolId: "old" };
    const recent = { ...tombstoneFromSymbol(symbol(), 8), symbolId: "recent" };
    const referenced = { ...tombstoneFromSymbol(symbol(), 1), symbolId: "ref" };
    const merged = mergeTombstones([old, recent, referenced], [], new Set(["ref"]), 9, 3);
    expect(merged.map((tombstone) => tombstone.symbolId)).toEqual(["recent", "ref"]);
  });

  it("preserves earliest generation and rename target", () => {
    const existing: Tombstone = { ...tombstoneFromSymbol(symbol(), 2, "new"), symbolId: "x" };
    const fresh: Tombstone = { ...tombstoneFromSymbol(symbol(), 9), symbolId: "x" };
    const merged = mergeTombstones([existing], [fresh], new Set(), 10, 20);
    expect(merged[0]).toMatchObject({ removedInGeneration: 2, renamedTo: "new" });
  });

  it("handles a previous tombstone without a rename target", () => {
    const existing: Tombstone = { ...tombstoneFromSymbol(symbol(), 2), symbolId: "x" };
    const fresh: Tombstone = { ...tombstoneFromSymbol(symbol(), 9, "new"), symbolId: "x" };
    const merged = mergeTombstones([existing], [fresh], new Set(), 10, 20);
    expect(merged[0].renamedTo).toBe("new");
  });

  it("advances generations", () => {
    expect(nextGeneration({ ...emptyLock(), generation: 4 })).toBe(5);
  });
});
