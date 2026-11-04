import { describe, expect, it } from "vitest";
import { describeLockDiff, diffLock } from "../src/lock/diff.js";
import type { LockEntry, LockFile } from "../src/types.js";

function entry(over: Partial<LockEntry> = {}): LockEntry {
  return {
    docPath: "docs/api.md",
    line: 1,
    contextFp: "ctx",
    token: "getUser",
    occurrence: 0,
    symbolId: "app|src/users|function|getUser|0",
    name: "getUser",
    qualifiedName: "app.src.users.getUser",
    kind: "function",
    shapeHash: "aaaa",
    shape: '{"kind":"function"}',
    paramNamesHash: "p",
    bodyHash: "b",
    confidence: 1,
    ...over,
  };
}

function lock(anchors: LockEntry[], tombstones = 0): LockFile {
  return {
    schema: 1,
    engine: "0.1.0",
    generation: 0,
    anchors,
    tombstones: Array.from({ length: tombstones }, (_, index) => ({
      symbolId: `old-${index}`,
      name: "old",
      qualifiedName: "app.old",
      kind: "function" as const,
      shapeHash: "old",
      shape: '{"kind":"function"}',
      bodyHash: "b",
      removedInGeneration: 1,
      renamedTo: "new",
    })),
  };
}

describe("lock diff", () => {
  it("reports added, removed, and changed anchors", () => {
    const before = lock([entry(), entry({ token: "removeMe" })], 2);
    const after = lock(
      [
        entry({ shapeHash: "bbbb", shape: '{"kind":"function","params":[]}' }),
        entry({ token: "added", symbolId: "added", qualifiedName: "app.added" }),
      ],
      1,
    );
    const diff = diffLock(before, after);
    expect(diff.added.map((item) => item.token)).toEqual(["added"]);
    expect(diff.removed.map((item) => item.token)).toEqual(["removeMe"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.tombstonesAdded).toBe(-1);
    expect(diff.tombstonesRemoved).toBe(1);
    const text = describeLockDiff(diff);
    expect(text.some((line) => line.startsWith("+ "))).toBe(true);
    expect(text.some((line) => line.startsWith("- "))).toBe(true);
    expect(text.some((line) => line.includes("contract changed"))).toBe(true);
    expect(text.some((line) => line.includes("old: "))).toBe(true);
  });

  it("describes symbol moves", () => {
    const diff = diffLock(lock([entry()]), lock([entry({ symbolId: "moved", qualifiedName: "app.moved" })]));
    const text = describeLockDiff(diff);
    expect(text.some((line) => line.includes("symbol moved"))).toBe(true);
    expect(text.some((line) => line.includes("to   app.moved"))).toBe(true);
  });

  it("reports an up-to-date lock", () => {
    expect(describeLockDiff(diffLock(lock([entry()]), lock([entry()])))).toEqual(["lock is up to date"]);
  });
});
