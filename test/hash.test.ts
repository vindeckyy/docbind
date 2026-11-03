import { describe, expect, it } from "vitest";
import { hashText, isUnionSubset, normalizeText, normalizeType, splitTopLevelUnion } from "../src/hash.js";

describe("hash", () => {
  it("hashes deterministically with a prefix length", () => {
    expect(hashText("hello")).toBe(hashText("hello"));
    expect(hashText("hello", 8)).toHaveLength(8);
    expect(hashText("hello")).not.toBe(hashText("world"));
  });

  it("normalizes unicode and whitespace", () => {
    expect(normalizeText("  a\n\t b  ")).toBe("a b");
    expect(normalizeText("e\u0301")).toBe("\u00e9");
  });

  it("normalizes type punctuation", () => {
    expect(normalizeType(" Array < string > ; ")).toBe("Array<string>");
    expect(normalizeType("A | B")).toBe("A|B");
    expect(normalizeType("{ a: string }")).toBe("{a:string}");
  });

  it("splits top level unions only", () => {
    expect(splitTopLevelUnion("A | B<C | D> | E")).toEqual(["A", "B<C | D>", "E"]);
    expect(splitTopLevelUnion("A")).toEqual(["A"]);
    expect(splitTopLevelUnion("A || B")).toEqual(["A", "B"]);
  });

  it("checks union subset", () => {
    expect(isUnionSubset(["A"], ["A", "B"])).toBe(true);
    expect(isUnionSubset(["A", "C"], ["A", "B"])).toBe(false);
  });
});
