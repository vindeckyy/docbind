import { describe, expect, it } from "vitest";
import { fenceAnchors, isSupportedFence } from "../src/docs/fences.js";
import type { Code } from "mdast";

function code(value: string, lang: string | null): Code {
  return {
    type: "code",
    lang: lang ?? undefined,
    value,
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 100, column: 1, offset: value.length },
    },
  };
}

describe("fence edge cases", () => {
  it("collects imports, locals and safe token references", () => {
    const source = `
import "./side";
import def from "./def";
import * as ns from "./ns";
import { a, b as c } from "./named";
const { x, y: z } = obj;
const [q] = arr;
const fn = (p: string) => p;
const obj2 = { key: p, other: fn };
const val = ns.value;
const qual = Api.B;
type Ann = Api.Type;
class K { m() {} }
interface I { x: number }
type T = string;
enum E { A }
namespace N { export const v = 1; }
const computed = getObj().prop;
const g = function inner() {};
const C = class Inner {};
export { fn as renamed };
`;
    const result = fenceAnchors(code(source, "ts"), "docs/api.md", "API");
    expect(result.imports.def).toEqual({ source: "./def", imported: "default" });
    expect(result.imports.ns).toEqual({ source: "./ns", imported: "*" });
    expect(result.imports.a).toEqual({ source: "./named", imported: "a" });
    expect(result.imports.c).toEqual({ source: "./named", imported: "b" });
    expect(result.imports.side).toBeUndefined();
    const anchor = result.anchors[0];
    expect(anchor.localDecls).toEqual(expect.arrayContaining([
      "x", "z", "q", "p", "fn", "obj2", "val", "qual", "K", "I", "T", "E", "N", "v", "computed", "g", "C",
    ]));
    const tokens = result.anchors.map((item) => item.token);
    expect(tokens).toContain("obj");
    expect(tokens).toContain("Api");
    expect(tokens).toContain("getObj");
    expect(tokens).not.toContain("def");
    expect(tokens).not.toContain("key");
    expect(tokens).not.toContain("value");
    expect(tokens).not.toContain("m");
    expect(tokens).not.toContain("inner");
    expect(tokens).not.toContain("renamed");
  });

  it("handles python imports and locals", () => {
    const source = `
from .users import (get_user as gu, Client)
from pkg import *
from pkg.extra import a,
import os
import pkg.mod as pm
import something
import .
async def run(a):
    return a
class K:
    pass
x = 1
`;
    const result = fenceAnchors(code(source, "python"), "docs/api.md", "API");
    expect(result.imports.gu).toEqual({ source: ".users", imported: "get_user" });
    expect(result.imports.Client).toEqual({ source: ".users", imported: "Client" });
    expect(result.imports.os).toEqual({ source: "os", imported: "*" });
    expect(result.imports.pm).toEqual({ source: "pkg.mod", imported: "*" });
    expect(result.imports.something).toEqual({ source: "something", imported: "*" });
    expect(result.anchors[0].localDecls).toEqual(expect.arrayContaining(["run", "K", "x"]));
    expect(result.anchors.map((item) => item.token)).toContain("gu");
    const shadow = { type: "code", lang: "ts", value: "getUser()" } as unknown as Code;
    expect(fenceAnchors(shadow, "docs/api.md", "API").anchors[0].line).toBe(2);
  });

  it("extracts rust and go fence references", () => {
    const rust = fenceAnchors(code(`
use crate::users::User;
use crate::repo::Repo as R;
const local = 1;
pub fn demo(value: User) -> R { todo!() }
`, "rust"), "docs/api.md", "Rust");
    expect(rust.imports.User).toEqual({ source: "crate::users::User", imported: "User" });
    expect(rust.imports.R).toEqual({ source: "crate::repo::Repo", imported: "Repo" });
    expect(rust.anchors[0].localDecls).toEqual(expect.arrayContaining(["local", "demo"]));
    expect(rust.anchors.map((anchor) => anchor.token)).toContain("User");

    const go = fenceAnchors(code(`
import "example.com/users"
import u "example.com/util"
func Demo(value User) u.Option { return u.Option{} }
`, "go"), "docs/api.md", "Go");
    expect(go.imports.users).toEqual({ source: "example.com/users", imported: "users" });
    expect(go.imports.u).toEqual({ source: "example.com/util", imported: "util" });
    expect(go.anchors[0].localDecls).toContain("Demo");
    expect(go.anchors.map((anchor) => anchor.token)).toContain("User");
    expect(isSupportedFence("rust")).toBe(true);
    expect(isSupportedFence("go")).toBe(true);
  });

  it("marks malformed rust and go fences as fragments", () => {
    expect(fenceAnchors(code('let x = "open', "rust"), "docs/api.md", "Rust").anchors[0].fragment).toBe(true);
    expect(fenceAnchors(code("func F( {", "go"), "docs/api.md", "Go").anchors.length).toBeGreaterThan(0);
  });

  it("supports only known languages", () => {
    expect(fenceAnchors(code("x = 1", "toml"), "docs/api.md", "API").anchors).toEqual([]);
    expect(fenceAnchors(code("x", null), "docs/api.md", "API").anchors).toEqual([]);
  });

  it("treats parse failures as fragments", () => {
    const result = fenceAnchors(code("const x = ;\ngetUser()", "ts"), "docs/api.md", "API");
    expect(result.anchors[0]?.fragment).toBe(true);
  });
});
