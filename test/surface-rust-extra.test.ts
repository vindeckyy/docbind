import { describe, expect, it } from "vitest";
import { extractRust } from "../src/surface/rust.js";
import { tempProject } from "./helpers.js";

function extraRust(): string {
  return tempProject({
    "Cargo.toml": '[package]\nname = "extra"\n',
    "src/extra.rs": `
pub struct Empty;
pub struct Tuple(pub String, i32);
pub struct Boxed<T>(T);

pub enum Unit { A, B }
pub enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
}

pub trait Defaults {
    fn default_value(&self) -> u8 { 1 }
    type Assoc;
}

impl<T: Clone> Boxed<T> {
    pub fn value(&self) -> &T { &self.0 }
}

pub(crate) fn crate_only() {}
pub(in crate::x) fn restricted() {}
pub extern "C" fn ffi() {}
pub static mut GLOBAL: usize = 0;
pub const NO_TYPE = 1;
pub type Plain = String;
pub fn no_args() {}
pub fn pattern((a, b): (u8, u8)) -> u8 { a + b }
pub use crate::x::Y;
pub use crate::x::{A, B};

mod private {
    pub fn hidden_in_private() {}
}

#[cfg(feature = "extra")]
pub fn feature_gated() {}

#[repr(C)]
pub struct Repr;

pub struct Restricted {
    pub(crate) hidden_field: u8,
    pub visible: u8,
}
pub trait Bounds: A + B {
    fn one(&self) -> u8;
    fn two(&self) -> u8 { 2 }
}
pub fn no_return<T>(value: T) where T: Send { }
pub fn no_name_ok() {}
pub type Alias;
pub const BARE;
pub use crate::x::Y as Z;
pub use crate::x::*;
pub mod skip {
    pub(crate) fn crate_item() {}
}
#[deprecated]
pub struct Old;
#[cfg(test)]
pub fn test_only() {}
macro_rules! noop { () => {}; }
pub fn text(value: &str) -> &str { value }
pub const fn const_fn() {}
struct Hidden;
impl Hidden { pub fn lost(&self) {} }
pub use crate::x::Y as A;
pub use crate::x::Y as A;
`,
    "src/empty.rs": "",
    "src/bad.rs": "pub struct Broken {",
    "src/bad2.rs": "pub enum E {",
    "src/bad3.rs": "pub trait T {",
    "src/bad4.rs": "pub fn f(",
    "src/bad5.rs": "pub mod m {",
    "src/bad6.rs": "impl X {",
    "src/bad7.rs": "pub fn f() ->",
    "src/bad8.rs": "pub fn f<T",
    "src/bad9.rs": "#[deprecated]",
    "src/bad10.rs": "pub use crate::x::{A;",
    "src/bad11.rs": "pub struct T(u8",
    "src/bad12.rs": "pub struct T(u8)",
    "src/bad13.rs": "pub trait T:",
    "src/bad14.rs": "pub type T =",
    "src/bad15.rs": "pub const C: u8",
    "src/bad16.rs": "pub mod m;",
    "src/bad17.rs": "impl X",
    "src/bad18.rs": "pub struct S { pub(crate) }",
    "src/bad19.rs": "pub enum E { 1 }",
    "src/bad20.rs": "pub trait T { fn }",
    "src/bad21.rs": "pub use crate::x::{A, B;",
    "src/bad22.rs": "pub fn f(x)",
    "src/bad23.rs": "#[deprecated",
    "src/bad24.rs": "pub(crate fn bad() {}",
    "src/bad25.rs": "pub extern C fn ffi2() {}",
    "src/bad26.rs": "pub",
    "src/bad27.rs": "pub fn f() {",
    "src/bad28.rs": "pub struct",
    "src/bad29.rs": "pub struct S { pub(crate }",
    "src/bad30.rs": "pub struct S { : u8 }",
    "src/bad31.rs": "pub enum",
    "src/bad32.rs": "pub trait",
    "src/bad33.rs": "pub trait T: {",
    "src/bad34.rs": "pub type",
    "src/bad35.rs": "pub const",
    "src/bad36.rs": "pub mod",
  });
}

describe("Rust surface edge cases", () => {
  it("handles tuple structs, unit enums and generic impls", () => {
    const root = extraRust();
    const result = extractRust(root, ["src/extra.rs"]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining([
      "Empty", "Tuple", "Boxed", "Unit", "Message", "Defaults", "value",
      "GLOBAL", "NO_TYPE", "Plain", "no_args", "pattern", "feature_gated", "Repr",
    ]));
    expect(names).not.toContain("crate_only");
    expect(names).not.toContain("restricted");
    expect(names).not.toContain("hidden_in_private");
    const boxed = result.symbols.find((symbol) => symbol.name === "Boxed");
    expect(boxed?.shape.typeParams).toBe("T");
    expect(boxed?.shape.members?.map((member) => member.name)).toEqual(expect.arrayContaining(["0"]));
    const message = result.symbols.find((symbol) => symbol.name === "Message");
    expect(message?.shape.enumMembers).toHaveLength(3);
    expect(message?.shape.enumMembers?.find((member) => member.name === "Move")?.value).toContain("x");
    expect(result.symbols.find((symbol) => symbol.name === "value")?.parentId).toContain("Boxed");
    expect(result.symbols.find((symbol) => symbol.name === "ffi")?.shape.params).toEqual([]);
    expect(result.symbols.find((symbol) => symbol.name === "no_args")?.shape.params).toEqual([]);
    expect(result.symbols.find((symbol) => symbol.name === "pattern")?.shape.params?.[0].name).toContain("a");
    expect(result.symbols.find((symbol) => symbol.name === "Restricted")?.shape.members?.map((member) => member.name)).toEqual(
      expect.arrayContaining(["visible"]),
    );
    expect(result.symbols.find((symbol) => symbol.name === "Bounds")?.shape.extends).toEqual(expect.arrayContaining(["A", "B"]));
    expect(result.symbols.find((symbol) => symbol.name === "Z")).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "text")?.shape.returnType).toBe("&str");
    expect(result.symbols.find((symbol) => symbol.name === "const_fn")?.shape.async).toBe(false);
    expect(result.symbols.find((symbol) => symbol.name === "lost")).toBeUndefined();
  });

  it("ignores empty files and handles use aliases", () => {
    const root = extraRust();
    expect(extractRust(root, ["src/empty.rs"]).symbols).toEqual([]);
    expect(extractRust(root, ["src/missing.rs"]).parseFailures).toBe(1);
    expect(extractRust(root, [
      "src/bad.rs", "src/bad2.rs", "src/bad3.rs", "src/bad4.rs", "src/bad5.rs",
      "src/bad6.rs", "src/bad7.rs", "src/bad8.rs", "src/bad9.rs", "src/bad10.rs",
      "src/bad11.rs", "src/bad12.rs", "src/bad13.rs", "src/bad14.rs", "src/bad15.rs",
      "src/bad16.rs", "src/bad17.rs", "src/bad18.rs", "src/bad19.rs", "src/bad20.rs",
      "src/bad21.rs", "src/bad22.rs", "src/bad23.rs", "src/bad24.rs", "src/bad25.rs",
      "src/bad26.rs", "src/bad27.rs", "src/bad28.rs", "src/bad29.rs", "src/bad30.rs",
      "src/bad31.rs", "src/bad32.rs", "src/bad33.rs", "src/bad34.rs", "src/bad35.rs",
      "src/bad36.rs",
    ]).parseFailures).toBeGreaterThan(0);
  });
});
