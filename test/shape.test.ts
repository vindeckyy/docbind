import { describe, expect, it } from "vitest";
import {
  bodyHash,
  canonicalShape,
  flagsFromNames,
  jaccard,
  paramNamesHash,
  shapeHash,
  shapeTokens,
  stableStringify,
} from "../src/shape/canonical.js";
import { compareShapeClaims, isKindCompatible } from "../src/shape/compat.js";
import type { ParamShape, Shape } from "../src/types.js";

function param(name: string, over: Partial<ParamShape> = {}): ParamShape {
  return {
    name,
    type: "string",
    optional: false,
    rest: false,
    hasDefault: false,
    ...over,
  };
}

function fn(over: Partial<Shape> = {}): Shape {
  return { kind: "function", params: [], ...over };
}

describe("canonical shapes", () => {
  it("excludes parameter names from the hash", () => {
    const left = fn({ params: [param("a"), param("b", { optional: true })] });
    const right = fn({ params: [param("x"), param("y", { optional: true })] });
    expect(canonicalShape(left)).toBe(canonicalShape(right));
    expect(paramNamesHash(left.params)).not.toBe(paramNamesHash(right.params));
    expect(shapeHash(left)).toBe(shapeHash(right));
    expect(paramNamesHash(undefined)).toBe(paramNamesHash([]));
    expect(paramNamesHash([{ ...param("a"), name: undefined }])).toBe(paramNamesHash([param("")]));
    expect(bodyHash(undefined)).toBe(bodyHash(""));
    expect(flagsFromNames(["unknown", "@static"])).toEqual(["static"]);
  });

  it("sorts keys and members deterministically", () => {
    const left = fn({ members: [
      { name: "b", kind: "property", optional: false, shape: { kind: "property", typeShape: "string" } },
      { name: "a", kind: "property", optional: true, shape: { kind: "property", typeShape: "number" } },
    ] });
    const right = fn({ members: [...(left.members ?? [])].reverse() });
    expect(canonicalShape(left)).toBe(canonicalShape(right));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("hashes bodies and flags", () => {
    expect(bodyHash(" a  b ")).toBe(bodyHash("a b"));
    expect(bodyHash("a")).not.toBe(bodyHash("b"));
    expect(flagsFromNames(["static", "@deprecated", "property", "abstract"])).toEqual([
      "static",
      "deprecated",
      "abstract",
    ]);
  });

  it("serializes every optional shape field", () => {
    const full: Shape = {
      kind: "class",
      async: true,
      generator: true,
      abstract: true,
      typeParams: "T",
      params: [param("a")],
      returnType: "R",
      visibility: "public",
      flags: ["static", "readonly"],
      extends: ["Base"],
      implements: ["Face"],
      members: [{ name: "m", kind: "method", optional: false, shape: { kind: "method", params: [] } }],
      typeShape: "X",
      literalKind: "object",
      enumMembers: [{ name: "A", value: "1" }],
      overload: 2,
    };
    const text = canonicalShape(full);
    expect(JSON.parse(text)).toMatchObject({
      kind: "class",
      extends: ["Base"],
      implements: ["Face"],
      overload: 2,
    });
    expect(canonicalShape({ kind: "function", params: [{ ...param("a"), kind: undefined }] }))
      .toContain('"kind":"positional"');
  });

  it("compares token sets", () => {
    const left = shapeTokens('{"alpha":1,"beta":2}');
    const right = shapeTokens('{"alpha":1,"gamma":2}');
    expect(jaccard(left, right)).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["a"]))).toBe(1);
  });

  it("checks compatible kinds", () => {
    expect(isKindCompatible("function", "method")).toBe(true);
    expect(isKindCompatible("class", "interface")).toBe(true);
    expect(isKindCompatible("function", "class")).toBe(false);
  });
});

describe("shape compatibility", () => {
  it("treats identical shapes as unchanged", () => {
    expect(compareShapeClaims(fn(), fn()).breaking).toBe(false);
  });

  it("flags kind changes", () => {
    const result = compareShapeClaims(fn(), { kind: "class" });
    expect(result.breaking).toBe(true);
    expect(result.changes[0]).toContain("kind changed");
  });

  it("handles async, generator and type parameters", () => {
    expect(compareShapeClaims(fn(), fn({ async: true })).breaking).toBe(true);
    expect(compareShapeClaims(fn(), fn({ generator: true })).breaking).toBe(true);
    expect(compareShapeClaims(fn({ typeParams: "T" }), fn({ typeParams: "U" })).breaking).toBe(true);
  });

  it("handles parameter additions and removals", () => {
    const required = compareShapeClaims(fn(), fn({ params: [param("x")] }));
    expect(required.breaking).toBe(true);
    expect(required.changes.join(" ")).toContain("required parameter");
    const optional = compareShapeClaims(fn(), fn({ params: [param("x", { optional: true })] }));
    expect(optional.breaking).toBe(false);
    expect(optional.additive).toBe(true);
    const removed = compareShapeClaims(fn({ params: [param("x")] }), fn());
    expect(removed.breaking).toBe(true);
    expect(removed.changes.join(" ")).toContain("removed parameter");
  });

  it("handles optionality, defaults and rest", () => {
    expect(compareShapeClaims(
      fn({ params: [param("x", { optional: true })] }),
      fn({ params: [param("x")] }),
    ).breaking).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("x")] }),
      fn({ params: [param("x", { optional: true })] }),
    ).additive).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("x", { hasDefault: true, optional: true })] }),
      fn({ params: [param("x")] }),
    ).breaking).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("x")] }),
      fn({ params: [param("x", { hasDefault: true, optional: true })] }),
    ).additive).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("x")] }),
      fn({ params: [param("x", { rest: true })] }),
    ).breaking).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("a"), param("b")] }),
      fn({ params: [param("a"), param("c")] }),
    ).softParamRename).toBe(true);
  });

  it("widens and narrows parameter and return types", () => {
    expect(compareShapeClaims(
      fn({ params: [param("x", { type: "A" })] }),
      fn({ params: [param("x", { type: "A | B" })] }),
    ).additive).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("x", { type: "A | B" })] }),
      fn({ params: [param("x", { type: "A" })] }),
    ).breaking).toBe(true);
    expect(compareShapeClaims(
      fn({ returnType: "A" }),
      fn({ returnType: "A | B" }),
    ).additive).toBe(true);
    expect(compareShapeClaims(
      fn({ returnType: "A | B" }),
      fn({ returnType: "A" }),
    ).breaking).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("x", { type: "any" })] }),
      fn({ params: [param("x", { type: "A" })] }),
    ).breaking).toBe(false);
    expect(compareShapeClaims(
      fn({ returnType: "A" }),
      fn({ returnType: "unknown" }),
    ).additive).toBe(true);
    expect(compareShapeClaims(
      fn({ params: [param("x", { type: "any" })] }),
      fn({ params: [param("x", { type: "string" })] }),
    ).breaking).toBe(false);
  });

  it("handles unnamed parameters and missing fields", () => {
    const unnamedRequired = compareShapeClaims(
      fn(),
      fn({ params: [param(undefined as unknown as string, { name: undefined, type: "" })] }),
    );
    expect(unnamedRequired.breaking).toBe(true);
    const unnamedDefault = compareShapeClaims(
      fn({ params: [param(undefined as unknown as string, { name: undefined, optional: true, hasDefault: true })] }),
      fn({ params: [param(undefined as unknown as string, { name: undefined })] }),
    );
    expect(unnamedDefault.breaking).toBe(true);
    const unnamedOptional = compareShapeClaims(
      fn({ params: [param(undefined as unknown as string, { name: undefined })] }),
      fn({ params: [param(undefined as unknown as string, { name: undefined, optional: true })] }),
    );
    expect(unnamedOptional.additive).toBe(true);
    expect(compareShapeClaims(fn(), fn({ params: [] })).breaking).toBe(false);
    expect(compareShapeClaims(
      { kind: "function" },
      { kind: "function", returnType: "A" },
    ).breaking).toBe(false);
  });

  it("handles visibility and flags", () => {
    expect(compareShapeClaims(fn({ visibility: "public" }), fn({ visibility: "private" })).breaking).toBe(true);
    expect(compareShapeClaims(fn({ visibility: "private" }), fn({ visibility: "public" })).additive).toBe(true);
    expect(compareShapeClaims(fn(), fn({ visibility: "private" })).breaking).toBe(true);
    expect(compareShapeClaims(fn({ flags: ["static"] }), fn()).breaking).toBe(true);
    expect(compareShapeClaims(fn(), fn({ flags: ["static"] })).additive).toBe(true);
    expect(compareShapeClaims(fn({ flags: ["deprecated"] }), fn()).breaking).toBe(false);
    expect(compareShapeClaims(fn(), fn({ flags: ["deprecated"] })).breaking).toBe(false);
  });

  it("handles classes and interfaces", () => {
    const base: Shape = { kind: "class", extends: ["Base"], implements: ["I"], members: [] };
    expect(compareShapeClaims(base, { ...base, extends: ["Other"] }).breaking).toBe(true);
    expect(compareShapeClaims(base, { ...base, implements: [] }).breaking).toBe(true);
    expect(compareShapeClaims(base, { ...base, abstract: true }).breaking).toBe(true);
    const withMember: Shape = {
      ...base,
      members: [{ name: "x", kind: "property", optional: false, shape: { kind: "property", typeShape: "string" } }],
    };
    expect(compareShapeClaims(withMember, base).breaking).toBe(true);
    expect(compareShapeClaims(base, {
      ...base,
      members: [{ name: "x", kind: "property", optional: true, shape: { kind: "property", typeShape: "string" } }],
    }).additive).toBe(true);
    expect(compareShapeClaims(base, {
      ...base,
      members: [{ name: "x", kind: "property", optional: false, shape: { kind: "property", typeShape: "string" } }],
    }).breaking).toBe(true);
    expect(compareShapeClaims(base, {
      ...base,
      members: [{ name: "m", kind: "method", optional: false, shape: { kind: "method", params: [] } }],
    }).additive).toBe(true);
    expect(compareShapeClaims(withMember, {
      ...withMember,
      members: [{ name: "x", kind: "property", optional: true, shape: { kind: "property", typeShape: "string" } }],
    }).additive).toBe(true);
    expect(compareShapeClaims(
      { ...withMember, members: [{ name: "x", kind: "property", optional: true, shape: { kind: "property", typeShape: "string" } }] },
      withMember,
    ).breaking).toBe(true);
    expect(compareShapeClaims(withMember, {
      ...withMember,
      members: [{ name: "x", kind: "property", optional: false, shape: { kind: "property", typeShape: "number" } }],
    }).breaking).toBe(true);
  });

  it("handles type aliases, constants, enums and modules", () => {
    expect(compareShapeClaims({ kind: "type", typeShape: "A" }, { kind: "type", typeShape: "B" }).breaking).toBe(true);
    expect(compareShapeClaims({ kind: "type" }, { kind: "type", typeShape: "A" }).breaking).toBe(false);
    expect(compareShapeClaims({ kind: "type", typeShape: "A" }, { kind: "type", typeShape: "A | B" }).additive).toBe(true);
    expect(compareShapeClaims({ kind: "type", typeShape: "A" }, { kind: "type", typeShape: "A | B" }).additive).toBe(true);
    expect(compareShapeClaims({ kind: "const", typeShape: "string" }, { kind: "const", typeShape: "number" }).breaking).toBe(true);
    expect(compareShapeClaims({ kind: "const", typeShape: "string" }, { kind: "const", typeShape: "string | null" }).additive).toBe(true);
    const enumShape: Shape = { kind: "enum", enumMembers: [{ name: "A", value: "0" }] };
    expect(compareShapeClaims(enumShape, { kind: "enum", enumMembers: [] }).breaking).toBe(true);
    expect(compareShapeClaims({ kind: "enum" }, { kind: "enum" }).breaking).toBe(false);
    expect(compareShapeClaims({ kind: "enumMember" }, { kind: "enumMember" }).breaking).toBe(false);
    expect(compareShapeClaims(enumShape, {
      kind: "enum",
      enumMembers: [{ name: "A", value: "0" }, { name: "B", value: "1" }],
    }).additive).toBe(true);
    expect(compareShapeClaims(
      { kind: "enumMember", literalKind: "string" },
      { kind: "enumMember", literalKind: "number" },
    ).breaking).toBe(true);
    expect(compareShapeClaims(
      { kind: "module", params: [] },
      { kind: "module", params: [param("x")] },
    ).breaking).toBe(true);
    expect(compareShapeClaims(
      { kind: "property", typeShape: "A" },
      { kind: "property", typeShape: "B" },
    ).breaking).toBe(true);
  });
});
