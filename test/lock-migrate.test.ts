import { describe, expect, it } from "vitest";
import { migrateLock } from "../src/lock/migrate.js";
import { LOCK_FORMAT } from "../src/lock/schema.js";

const legacyAnchor = {
  docPath: "docs/api.md",
  line: 3,
  contextFp: "ctx",
  token: "getUser",
  occurrence: 0,
  symbolId: "app|src/users|function|getUser|0",
  name: "getUser",
  qualifiedName: "app.src.users.getUser",
  kind: "function",
  shapeHash: "aaaa",
  shape: "{}",
  paramNamesHash: "p",
  bodyHash: "b",
};

describe("lock migration", () => {
  it("upgrades a legacy lock and is idempotent", () => {
    const legacy = {
      engine: "0.1.0",
      generation: 2,
      anchors: [{ ...legacyAnchor, unknown: true }],
      tombstones: [],
    };
    const first = migrateLock(legacy);
    expect(first.changed).toBe(true);
    expect(first.lock.schema).toBe(1);
    expect(first.lock.format).toBe(LOCK_FORMAT);
    expect(first.lock.anchors[0]?.confidence).toBe(1);
    expect(first.actions.some((action) => action.includes("dropped unknown fields"))).toBe(true);
    const second = migrateLock(first.lock);
    expect(second.changed).toBe(false);
    expect(second.actions).toEqual([]);
  });

  it("rejects newer schemas and non-objects", () => {
    expect(() => migrateLock({ schema: 2 })).toThrow(/newer than this engine/u);
    expect(() => migrateLock({ schema: 0 })).toThrow(/unsupported lock schema/u);
    expect(() => migrateLock(null)).toThrow(/JSON object/u);
    expect(() => migrateLock({ anchors: "bad" })).toThrow(/anchors must be an array/u);
  });
});
