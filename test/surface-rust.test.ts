import { describe, expect, it } from "vitest";
import { extractRust } from "../src/surface/rust.js";
import { tempProject } from "./helpers.js";

function rustProject(): string {
  return tempProject({
    "Cargo.toml": '[package]\nname = "rustapp"\nversion = "0.1.0"\n',
    "src/lib.rs": `
use std::collections::HashMap;

#[derive(Debug)]
pub struct User {
    pub id: String,
    email: String,
}

pub struct Pair(pub String, i32);

pub enum Role {
    Admin,
    User(String),
}

pub trait Repo: Send {
    type Item;
    const LIMIT: usize;
    fn get(&self, id: &str) -> Option<User>;
    fn put(&mut self, user: User);
}

impl User {
    pub fn new(id: String) -> Self {
        Self { id, email: String::new() }
    }
    fn hidden(&self) {}
}

impl Repo for User {
    type Item = User;
    const LIMIT: usize = 1;
    fn get(&self, id: &str) -> Option<User> { None }
    fn put(&mut self, user: User) {}
}

pub async fn fetch_user<T: Clone>(id: &str, opts: Option<T>) -> Result<User, Error>
where
    T: Send,
{
    unimplemented!()
}

pub unsafe fn dangerous(ptr: *const u8) -> u8 { *ptr }
pub const VERSION: &str = "1";
pub static mut COUNT: usize = 0;
pub type UserId = String;
pub mod inner {
    pub fn nested() {}
    fn private() {}
}
#[deprecated]
pub fn old() {}
#[doc(hidden)]
pub fn hidden_api() {}
#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {}
}
macro_rules! ignored { () => {}; }
pub use User as Account;
pub use users::User as GlobalAccount;
pub use users::{User as GroupAccount, Account};
`,
    "src/users.rs": `
pub struct User;
pub struct Account {
    pub name: String,
}
`,
    "src/impls.rs": `
use crate::users::User;
impl User {
    pub fn display(&self) -> String { String::new() }
}
`,
    "src/bad.rs": 'pub fn broken( { let x = "open;',
  });
}

describe("Rust surface", () => {
  it("extracts public items, methods and fields", () => {
    const root = rustProject();
    const result = extractRust(root, ["src/lib.rs", "src/users.rs", "src/impls.rs"]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining([
      "User", "Pair", "Role", "Repo", "fetch_user", "dangerous", "VERSION",
      "COUNT", "UserId", "inner", "nested", "old", "Account", "id", "new",
      "get", "put", "LIMIT", "Item",
    ]));
    expect(names).not.toContain("hidden");
    expect(names).not.toContain("hidden_api");
    expect(names).not.toContain("private");
    expect(names).not.toContain("tests");
    expect(result.symbols.find((symbol) => symbol.name === "old")?.contractFlags).toContain("deprecated");
    expect(result.symbols.find((symbol) => symbol.name === "fetch_user")?.shape.async).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "dangerous")?.contractFlags).toContain("unsafe");
    expect(result.symbols.find((symbol) => symbol.name === "User")?.aliases).toEqual(
      expect.arrayContaining(["Account", "GlobalAccount", "GroupAccount"]),
    );
    expect(result.symbols.find((symbol) => symbol.name === "User")?.modulePath).toBe("src/lib");
    expect(result.symbols.find((symbol) => symbol.name === "User")?.aliases).toContain("rustapp.User");
    expect(result.symbols.find((symbol) => symbol.name === "display")?.parentId).toContain("User");
  });

  it("builds signatures and receiver shapes", () => {
    const root = rustProject();
    const result = extractRust(root, ["src/lib.rs"]);
    const fetch = result.symbols.find((symbol) => symbol.name === "fetch_user");
    expect(fetch?.shape.params?.map((param) => param.name)).toEqual(["id", "opts"]);
    expect(fetch?.shape.returnType).toBe("Result<User,Error>");
    expect(fetch?.shape.typeParams).toContain("T");
    const get = result.symbols.find((symbol) => symbol.name === "get" && symbol.parentId?.includes("Repo"));
    expect(get?.shape.params?.[0]).toMatchObject({ name: "self", kind: "receiver" });
  });

  it("adds aliases from use declarations and nested modules", () => {
    const root = rustProject();
    const result = extractRust(root, ["src/lib.rs"]);
    expect(result.symbols.find((symbol) => symbol.name === "User")?.aliases).toEqual(
      expect.arrayContaining(["Account", "GlobalAccount", "GroupAccount"]),
    );
    expect(result.symbols.find((symbol) => symbol.name === "nested")?.qualifiedName).toContain("inner.nested");
  });

  it("counts parse failures for malformed files and missing files", () => {
    const root = rustProject();
    const result = extractRust(root, ["src/bad.rs", "src/missing.rs"]);
    expect(result.parseFailures).toBeGreaterThan(0);
  });

  it("handles empty and unexported files", () => {
    const root = tempProject({ "src/empty.rs": "fn private() {}" });
    expect(extractRust(root, ["src/empty.rs"]).symbols).toEqual([]);
    expect(extractRust(root, [])).toEqual({ symbols: [], parseFailures: 0, filesScanned: 0 });
  });
});
