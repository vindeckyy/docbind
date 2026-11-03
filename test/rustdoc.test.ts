import { describe, expect, it } from "vitest";
import { parseRustdocJson } from "../src/surface/rustdoc.js";
import { tempProject } from "./helpers.js";

describe("rustdoc JSON extraction", () => {
  it("extracts generated functions and impl methods", () => {
    const root = tempProject({ "app/src/lib.rs": "" });
    const data = {
      index: {
        "0": {
          name: "generated",
          visibility: "public",
          span: { filename: "app/src/lib.rs", begin: [1, 1] },
          inner: {
            function: {
              sig: { inputs: [], output: { primitive: "u8" } },
              generics: { params: [] },
              header: { is_async: false, is_unsafe: false },
            },
          },
        },
        "1": {
          name: "Existing",
          visibility: "public",
          span: { filename: "app/src/lib.rs", begin: [2, 1] },
          inner: { struct: { kind: "unit", generics: { params: [] }, impls: [2] } },
        },
        "2": {
          inner: {
            impl: { for: { resolved_path: { name: "Existing" } }, items: [3] },
          },
        },
        "4": {
          inner: {
            impl: {
              for: { resolved_path: { path: "Thing" } },
              items: [5],
            },
          },
        },
        "5": {
          name: "fmt",
          visibility: "default",
          span: { filename: "app/src/lib.rs", begin: [3, 1] },
          inner: {
            function: {
              sig: { inputs: [], output: { primitive: "()" } },
              generics: { params: [] },
              header: { is_async: false, is_unsafe: false },
            },
          },
        },
        "3": {
          name: "clone",
          visibility: "default",
          span: { filename: "app/src/lib.rs", begin: [2, 1] },
          inner: {
            function: {
              sig: { inputs: [{ borrowed_ref: { mutable: false, type: { generic: "Self" } } }], output: { generic: "Self" } },
              generics: { params: [] },
              header: { is_async: false, is_unsafe: true },
            },
          },
        },
      },
    };
    const symbols = parseRustdocJson(data as never, root, root, "app");
    expect(symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["generated", "clone"]));
    expect(symbols.find((symbol) => symbol.name === "generated")?.shape.returnType).toBe("u8");
    expect(symbols.find((symbol) => symbol.name === "clone")?.kind).toBe("method");
    expect(symbols.find((symbol) => symbol.name === "clone")?.aliases).toContain("Existing.clone");
    expect(symbols.find((symbol) => symbol.name === "clone")?.shape.flags).toContain("unsafe");
    expect(symbols.find((symbol) => symbol.name === "fmt")?.kind).toBe("method");
    expect(symbols.find((symbol) => symbol.name === "fmt")?.aliases).toContain("Thing.fmt");
  });

  it("handles empty and malformed indexes", () => {
    const root = tempProject({ "a.rs": "" });
    expect(parseRustdocJson({}, root, root, "app")).toEqual([]);
    expect(parseRustdocJson({ index: { "1": { name: "bad" } } }, root, root, "app")).toEqual([]);
  });
});

import { typeName, typeText } from "../src/surface/rustdoc.js";

describe("rustdoc type rendering", () => {
  it("renders primitive, generic and inferred types", () => {
    expect(typeText({ primitive: "u8" })).toBe("u8");
    expect(typeText({ generic: "T" })).toBe("T");
    expect(typeText({ infer: "_" })).toBe("_");
    expect(typeText(null)).toBe("");
    expect(typeText("x")).toBe("");
  });

  it("renders paths, references, pointers and containers", () => {
    expect(typeText({ resolved_path: { name: "Option", args: { angle_bracketed: { args: [{ type: { primitive: "u8" } }, { lifetime: "a" }] } } } })).toBe("Option<u8,'a>");
    expect(typeText({ resolved_path: { name: "Thing" } })).toBe("Thing");
    expect(typeText({ resolved_path: { args: {} } })).toBe("unknown");
    expect(typeText({ resolved_path: { path: "a::Thing" } })).toBe("Thing");
    expect(typeText({ borrowed_ref: { mutable: true, type: { primitive: "u8" } } })).toBe("&mut u8");
    expect(typeText({ borrowed_ref: { mutable: false, type: { primitive: "u8" } } })).toBe("&u8");
    expect(typeText({ raw_pointer: { mutable: true, type: { primitive: "u8" } } })).toBe("*mut u8");
    expect(typeText({ raw_pointer: { mutable: false, type: { primitive: "u8" } } })).toBe("*const u8");
    expect(typeText({ tuple: [{ primitive: "u8" }, { primitive: "u16" }] })).toBe("(u8,u16)");
    expect(typeText({ slice: { primitive: "u8" } })).toBe("[u8]");
    expect(typeText({ array: { type: { primitive: "u8" }, len: "3" } })).toBe("[u8;3]");
    expect(typeText({ qualified_path: { self_type: { primitive: "u8" } } })).toBe("u8");
    expect(typeText({ impl_trait: {} })).toBe("impl Trait");
    expect(typeText({ dyn_trait: {} })).toBe("dyn Trait");
  });

  it("extracts type names", () => {
    expect(typeName({ resolved_path: { name: "a::Thing" } })).toBe("Thing");
    expect(typeName({ resolved_path: { path: "a::Generated" } })).toBe("Generated");
    expect(typeName({ generic: "T" })).toBe("T");
    expect(typeName(null)).toBeUndefined();
    expect(typeName({})).toBeUndefined();
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractRustdoc } from "../src/surface/rustdoc.js";

describe("rustdoc extraction wiring", () => {
  it("runs metadata and rustdoc with injected cargo", () => {
    const root = tempProject({ "Cargo.toml": '[package]\nname = "app"\n', "src/lib.rs": "" });
    const target = join(root, "target");
    mkdirSync(join(target, "doc"), { recursive: true });
    writeFileSync(join(target, "doc/app.json"), JSON.stringify({
      index: {
        "0": {
          name: "generated",
          visibility: "public",
          span: { filename: "src/lib.rs", begin: [1, 1] },
          inner: { function: { sig: { inputs: [], output: { primitive: "u8" } }, generics: { params: [{ name: "T" }] }, header: {} } },
        },
      },
    }));
    const runner = (args: string[], cwd: string) => {
      if (args[0] === "metadata") {
        return {
          status: 0,
          stdout: JSON.stringify({ target_directory: target, packages: [{ name: "app", manifest_path: join(cwd, "Cargo.toml") }] }),
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const result = extractRustdoc(root, ["src/lib.rs"], runner);
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(["generated"]);
    expect(result.parseFailures).toBe(0);
    expect(result.symbols[0].shape.typeParams).toBe("T");
  });

  it("reports build and JSON failures", () => {
    const root = tempProject({ "Cargo.toml": '[package]\nname = "app"\n', "src/lib.rs": "" });
    const metadata = (cwd: string) => ({
      status: 0,
      stdout: JSON.stringify({ target_directory: join(cwd, "target"), packages: [{ name: "app", manifest_path: join(cwd, "Cargo.toml") }] }),
      stderr: "",
    });
    const failed = extractRustdoc(root, ["src/lib.rs"], (args, cwd) =>
      args[0] === "metadata" ? metadata(cwd) : { status: 1, stdout: "", stderr: "boom" }
    );
    expect(failed.parseFailures).toBe(1);
    expect(failed.error).toContain("boom");

    const missing = extractRustdoc(root, ["src/lib.rs"], (args, cwd) =>
      args[0] === "metadata" ? metadata(cwd) : { status: 0, stdout: "", stderr: "" }
    );
    expect(missing.parseFailures).toBe(1);

    const silent = extractRustdoc(root, ["src/lib.rs"], (args, cwd) =>
      args[0] === "metadata" ? metadata(cwd) : { status: 1, stdout: "", stderr: "" }
    );
    expect(silent.error).toContain("rustdoc failed");

    const badMetadata = extractRustdoc(root, ["src/lib.rs"], () => ({ status: 1, stdout: "", stderr: "" }));
    expect(badMetadata.symbols).toEqual([]);

    const emptyMetadata = extractRustdoc(root, ["src/lib.rs"], (args) =>
      args[0] === "metadata" ? { status: 0, stdout: "{}", stderr: "" } : { status: 0, stdout: "", stderr: "" }
    );
    expect(emptyMetadata.symbols).toEqual([]);
  });

  it("handles private, empty and trait items", () => {
    const root = tempProject({ "src/lib.rs": "" });
    const data = {
      index: {
        "1": { name: "private", visibility: "private", inner: { function: {} } },
        "2": { visibility: "public", inner: { function: {} } },
        "3": { name: "Trait", visibility: "public", inner: { trait: { items: [4, 99] } } },
        "4": { name: "method", visibility: "default", inner: { function: { sig: {}, generics: {}, header: {} } } },
        "5": { name: "Macro", visibility: "public", inner: { proc_macro: {} } },
        "6": { name: "NoSpan", visibility: "public", inner: { function: {} } },
        "7": { name: "NoTarget", visibility: "public", inner: { impl: { items: [4] } } },
        "8": { name: "NoItems", visibility: "public", inner: { impl: {} } },
        "9": { name: "EmptyTrait", visibility: "public", inner: { trait: {} } },
        "10": { name: "NoSpan", visibility: "public", span: { filename: "missing.rs" }, inner: { function: { sig: {}, generics: {}, header: {} } } },
      },
    };
    const symbols = parseRustdocJson(data as never, root, root, "app");
    expect(symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["method", "Macro", "NoSpan"]));
    expect(symbols.filter((symbol) => symbol.name === "method")).toHaveLength(2);
    expect(symbols.find((symbol) => symbol.name === "method")?.aliases).toContain("Trait.method");
    expect(symbols.find((symbol) => symbol.name === "method")?.kind).toBe("method");
  });
});

describe("rustdoc type shapes", () => {
  it("extracts structs, enums, traits, aliases and constants", () => {
    const root = tempProject({ "src/lib.rs": "" });
    const data = {
      index: {
        "1": {
          name: "Point",
          visibility: "public",
          span: { filename: "src/lib.rs", begin: [1, 1] },
          inner: { struct: { kind: { plain: { fields: [10, 11, 12] } }, generics: { params: [{ name: "T" }] } } },
        },
        "10": { name: "x", visibility: "public", inner: { struct_field: { primitive: "u8" } } },
        "11": { name: "y", visibility: "public", inner: { struct_field: { primitive: "u16" } } },
        "12": { visibility: "private", inner: { struct_field: { primitive: "u32" } } },
        "13": { name: "Tuple", visibility: "public", span: { filename: "src/lib.rs", begin: [6, 1] }, inner: { struct: { kind: { tuple: [12] }, generics: { params: [] } } } },
        "2": {
          name: "Mode",
          visibility: "public",
          span: { filename: "src/lib.rs", begin: [2, 1] },
          inner: { enum: { generics: { params: [] }, variants: [20, 21, 24] } },
        },
        "20": { name: "A", visibility: "default", inner: { variant: { kind: "plain" } } },
        "21": { name: "B", visibility: "default", inner: { variant: { kind: { tuple: [22] } } } },
        "22": { name: "0", visibility: "public", inner: { struct_field: { primitive: "u8" } } },
        "23": { visibility: "default", inner: { variant: { kind: "plain" } } },
        "24": { name: "C", visibility: "default", inner: { variant: { kind: { struct: { fields: [25] } } } } },
        "25": { visibility: "public", inner: { struct_field: { primitive: "u8" } } },
        "26": { name: "Empty", visibility: "public", span: { filename: "src/lib.rs", begin: [7, 1] }, inner: { enum: { generics: { params: [] } } } },
        "3": {
          name: "Walk",
          visibility: "public",
          span: { filename: "src/lib.rs", begin: [3, 1] },
          inner: { trait: { generics: { params: [] }, bounds: [{ primitive: "u8" }], items: [30] } },
        },
        "30": { name: "step", visibility: "default", inner: { function: { sig: { inputs: [["self", { borrowed_ref: { mutable: false, type: { generic: "Self" } } }], ["n", { primitive: "u8" }]] }, generics: {}, header: {} } } },
        "31": { name: "Point", visibility: "public", span: { filename: "src/lib.rs", begin: [8, 1] }, inner: { struct: { kind: "unit", generics: { params: [] } } } },
        "4": {
          name: "Alias",
          visibility: "public",
          span: { filename: "src/lib.rs", begin: [4, 1] },
          inner: { type_alias: { generics: { params: [] }, type: { primitive: "u8" } } },
        },
        "5": {
          name: "LIMIT",
          visibility: "public",
          span: { filename: "src/lib.rs", begin: [5, 1] },
          inner: { constant: { type: { primitive: "u8" } } },
        },
      },
    };
    const symbols = parseRustdocJson(data as never, root, root, "app");
    const point = symbols.find((symbol) => symbol.name === "Point");
    expect(point?.kind).toBe("class");
    expect(point?.shape.typeParams).toBe("T");
    expect(point?.shape.members?.map((member) => member.name)).toEqual(["x", "y"]);
    expect(symbols.find((symbol) => symbol.name === "x")?.aliases).toContain("Point.x");
    const mode = symbols.find((symbol) => symbol.name === "Mode");
    expect(mode?.shape.enumMembers?.map((member) => member.name)).toEqual(["A", "B", "C"]);
    expect(symbols.find((symbol) => symbol.name === "B")?.kind).toBe("enumMember");
    expect(symbols.find((symbol) => symbol.name === "C")?.kind).toBe("enumMember");
    expect(symbols.find((symbol) => symbol.name === "Empty")?.shape.enumMembers).toEqual([]);
    expect(symbols.find((symbol) => symbol.name === "Tuple")?.kind).toBe("class");
    const walk = symbols.find((symbol) => symbol.name === "Walk");
    expect(walk?.kind).toBe("interface");
    expect(walk?.shape.extends).toEqual(["u8"]);
    expect(symbols.find((symbol) => symbol.name === "step")?.shape.params?.[0].kind).toBe("receiver");
    expect(symbols.find((symbol) => symbol.name === "step")?.shape.params).toHaveLength(2);
    expect(symbols.find((symbol) => symbol.name === "Alias")?.shape.typeShape).toBe("u8");
    expect(symbols.find((symbol) => symbol.name === "LIMIT")?.kind).toBe("const");
  });
});
