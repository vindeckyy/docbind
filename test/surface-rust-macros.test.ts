import { describe, expect, it } from "vitest";
import { extractRust } from "../src/surface/rust.js";
import { tempProject } from "./helpers.js";

function macroProject(): string {
  return tempProject({
    "Cargo.toml": '[package]\nname = "macros"\n',
    "src/lib.rs": `
macro_rules! empty {
    () => { pub fn empty_generated() -> u8 { 0 } };
}
empty!();

macro_rules! tt_macro {
    ($t:tt) => { pub const TOKEN: u8 = 1; };
}
tt_macro!(x);

macro_rules! type_macro {
    ($t:ty) => { pub type TypeAlias = $t; };
}
type_macro!(u8);

macro_rules! vis_macro {
    ($vis:vis fn $name:ident()) => { $vis fn $name() {} };
}
vis_macro!(fn plain());
vis_macro!(pub(crate) fn crate_only());

macro_rules! choose {
    (a) => { pub fn alpha() {} };
    (b) => { pub fn beta() {} };
}
choose!(a);
choose!(b);
choose!(c);

macro_rules! paren_macro {
    () => ( pub fn paren_fn() {} );
}
paren_macro!();

macro_rules! brace_macro {
    () => { pub fn brace_fn() {} };
}
brace_macro! {}

macro_rules! bracket_body {
    () => [ pub fn bracket_fn() {} ];
}
bracket_body!();

macro_rules! bracket_rule {
    [x] => [ pub fn bracket_rule_fn() {} ];
}
bracket_rule![x];

macro_rules! wrong_arg {
    ($name:ident) => { pub fn $name() {} };
}
wrong_arg!(123);
wrong_arg!(a, b);
tt_macro!();

macro_rules! no_rules { }
no_rules!();
macro foo {}

macro_rules! methods {
    ($name:ident) => { pub fn $name(&self) {} };
}
pub struct Thing;
impl Thing { methods!(go); }

pub mod inner {
    macro_rules! nested {
        ($name:ident) => { pub fn $name() {} };
    }
    nested!(nested_fn);
}
`,
    "src/repeat.rs": `
macro_rules! many {
    ($($name:ident),*) => {
        $( pub fn $name() -> u8 { 0 } )*
    };
}
many!(one, two, three);
`,
    "src/nested.rs": `
macro_rules! nested {
    ($($($name:ident),*);*) => {
        $( $( pub fn $name() {} )* )*
    };
}
nested!(a, b; c);
`,
    "src/groups.rs": `
macro_rules! grouped {
    ($($group:ident { $($left:ident : $left_ty:ty),* } -> { $($right:ident : $right_ty:ty),* }),*) => {
        $(
            pub mod $group {
                $( pub fn $left() -> $left_ty { loop {} } )*
                $( pub fn $right() -> $right_ty { loop {} } )*
            }
        )*
    };
}
grouped!(
    g1 { a: u8, b: u16 } -> { x: u32 },
    g2 { c: u64 } -> { y: u8, z: u16 }
);
`,
    "src/independent.rs": `
macro_rules! split_lists {
    ($($left:ident),* ; $($right:ident),*) => {
        $( pub fn $left() {} )*
        $( pub fn $right() {} )*
    };
}
split_lists!(l1, l2; r1);
`,
    "src/macros.rs": `
#[macro_export]
macro_rules! cross {
    ($($name:ident),*) => {
        $( pub fn $name() -> u8 { 1 } )*
    };
}
`,
    "src/private_macros.rs": `
macro_rules! private_make {
    ($name:ident) => {
        pub fn $name() -> u8 { 4 }
    };
}
`,
    "src/private_use.rs": `
#[macro_use]
mod private_macros;
private_make!(private_generated);
`,
    "src/cross.rs": `
mod macros;
crate::cross!(cross_one, cross_two);
`,
    "src/bad-macro1.rs": "macro_rules! empty { () => {}; } empty!;",
    "src/bad-macro2.rs": "macro_rules! empty { () => {}; } empty!(x",
    "src/bad-macro3.rs": "macro_rules! vis { ($vis:vis fn $name:ident()) => { $vis fn $name() {} }; } vis!(pub(crate fn a());",
    "src/bad-macro4.rs": "macro_rules! no_arrow { (x) { pub fn x() {} } }",
    "src/bad-macro5.rs": "macro_rules! body_unclosed { () => { pub fn x() {} }",
    "src/bad-macro6.rs": "macro foo; macro bar {}",
    "src/bad-macro7.rs": "macro_rules! unclosed {",
    "src/bad.rs": `
macro_rules! no_body { () => ; }
macro_rules! invalid { ( => { pub fn nope() {} }; }
macro_rules! no_match { (x) => { pub fn x() {} }; }
no_match!(y);
unknown!(z);
macro_rules
macro foo {}
`,
  });
}

describe("Rust macro expansion", () => {
  it("expands simple item-generating macros", () => {
    const root = macroProject();
    const result = extractRust(root, ["src/lib.rs"]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining([
      "empty_generated", "TOKEN", "TypeAlias", "alpha", "beta", "paren_fn",
      "brace_fn", "bracket_fn", "bracket_rule_fn", "go", "nested_fn",
    ]));
    expect(names).not.toContain("plain");
    expect(names).not.toContain("crate_only");
    expect(names).not.toContain("c");
    expect(result.symbols.find((symbol) => symbol.name === "go")?.parentId).toContain("Thing");
    expect(result.symbols.find((symbol) => symbol.name === "nested_fn")?.qualifiedName).toContain("inner");
  });

  it("expands repetition and cross-file exported macros", () => {
    const root = macroProject();
    const repeated = extractRust(root, ["src/repeat.rs"]);
    expect(repeated.symbols.map((symbol) => symbol.name)).toEqual(["one", "two", "three"]);
    const cross = extractRust(root, ["src/macros.rs", "src/cross.rs"]);
    const names = cross.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining(["cross_one", "cross_two"]));
    const nested = extractRust(root, ["src/nested.rs"]);
    expect(nested.symbols.map((symbol) => symbol.name)).toEqual(["a", "b", "c"]);
    const groups = extractRust(root, ["src/groups.rs"]);
    const groupNames = groups.symbols.map((symbol) => symbol.name);
    expect(groupNames).toEqual(expect.arrayContaining(["g1", "g2", "a", "b", "x", "c", "y", "z"]));
    expect(groupNames).toHaveLength(8);
    expect(groups.symbols.find((symbol) => symbol.name === "a")?.qualifiedName).toContain("g1.a");
    expect(groups.symbols.find((symbol) => symbol.name === "b")?.qualifiedName).toContain("g1.b");
    expect(groups.symbols.find((symbol) => symbol.name === "c")?.qualifiedName).toContain("g2.c");
    expect(groups.symbols.find((symbol) => symbol.name === "a")?.aliases).toContain("g1.a");
    expect(groups.symbols.find((symbol) => symbol.name === "y")?.shape.returnType).toBe("u8");
    const independent = extractRust(root, ["src/independent.rs"]);
    expect(independent.symbols.map((symbol) => symbol.name)).toEqual(["l1", "l2", "r1"]);
  });

  it("expands non-exported macros from sibling modules", () => {
    const root = macroProject();
    const result = extractRust(root, ["src/private_macros.rs", "src/private_use.rs"]);
    expect(result.symbols.map((symbol) => symbol.name)).toContain("private_generated");
    expect(result.symbols.find((symbol) => symbol.name === "private_generated")?.shape.returnType).toBe("u8");
  });

  it("survives malformed macro definitions", () => {
    const root = macroProject();
    expect(extractRust(root, [
      "src/bad.rs", "src/bad-macro1.rs", "src/bad-macro2.rs", "src/bad-macro3.rs",
      "src/bad-macro4.rs", "src/bad-macro5.rs", "src/bad-macro6.rs", "src/bad-macro7.rs",
    ]).parseFailures).toBeGreaterThan(0);
    expect(extractRust(root, ["src/missing.rs"]).parseFailures).toBe(1);
  });
});
