import { describe, expect, it } from "vitest";
import { extractRust } from "../src/surface/rust.js";
import { tempProject } from "./helpers.js";

function edgeProject(): string {
  return tempProject({
    "Cargo.toml": '[package]\nname = "macro-edge"\n',
    "src/plus.rs": `
macro_rules! plus {
    ($($name:ident),+) => { $( pub fn $name() {} )* };
}
plus!(p1);
plus!();
`,
    "src/semis.rs": `
macro_rules! semis {
    ($($name:ident);*) => { $( pub fn $name() {} )* };
}
semis!(s1; s2);
`,
    "src/nosep.rs": `
macro_rules! nosep {
    ($($name:ident)*) => { $( pub fn $name() {} )* };
}
nosep!(n1 n2);
`,
    "src/badrep.rs": `
macro_rules! badrep {
    ($($name:ident),?) => { pub fn nope() {} };
}
badrep!(a);
`,
    "src/unclosed-matcher.rs": "macro_rules! um { ($($name:ident),* => { pub fn um() {} }; }",
    "src/unclosed-body.rs": "macro_rules! ub { () => { pub fn ub() {} ; }",
    "src/brace.rs": `
macro_rules! brace {
    () => { pub fn brace_generated() {} };
}
brace!{}
brace![]
`,
    "src/noargs.rs": `
macro_rules! noargs {
    ($name:ident) => { pub fn $name() {} };
}
noargs!();
`,
    "src/path.rs": `
macro_rules! pathmacro {
    () => { pub fn path_generated() {} };
}
crate::pathmacro!();
`,
    "src/sep-body.rs": `
macro_rules! sepbody {
    ($($name:ident),*) => { $( pub fn $name() {} ),* };
}
sepbody!(sb1, sb2);
macro_rules! emptybody {
    () => { $( pub fn nope() {} )* };
}
emptybody!();
macro_rules! badop {
    () => { $( pub fn nope2() {} )? };
}
badop!();
`,
    "src/bad-items.rs": `
macro_rules! baditems {
    ($($name:ident),*) => { $( pub fn $name() {} )* };
}
baditems!(good, 123);
`,
    "src/brace-matcher.rs": `
macro_rules! bm {
    { $name:ident } => { pub fn $name() {} };
}
bm!{brace_named};
`,
    "src/bad-invocation.rs": `
macro_rules! missing { () => {}; }
missing!;
macro_rules! empty { }
empty!();
`,
  });
}

describe("Rust macro repetition edges", () => {
  it("handles repetition separators, plus and no separator", () => {
    const root = edgeProject();
    const plus = extractRust(root, ["src/plus.rs"]);
    expect(plus.symbols.map((symbol) => symbol.name)).toEqual(["p1"]);
    const semis = extractRust(root, ["src/semis.rs"]);
    expect(semis.symbols.map((symbol) => symbol.name)).toEqual(["s1", "s2"]);
    const nosep = extractRust(root, ["src/nosep.rs"]);
    expect(nosep.symbols.map((symbol) => symbol.name)).toEqual(["n1", "n2"]);
    const sep = extractRust(root, ["src/sep-body.rs"]);
    expect(sep.symbols.map((symbol) => symbol.name)).toEqual(["sb1", "sb2"]);
    const brace = extractRust(root, ["src/brace-matcher.rs"]);
    expect(brace.symbols.map((symbol) => symbol.name)).toEqual(["brace_named"]);
    expect(extractRust(root, ["src/bad-items.rs"]).symbols).toEqual([]);
  });

  it("handles brace and bracket invocations and paths", () => {
    const root = edgeProject();
    const brace = extractRust(root, ["src/brace.rs"]);
    expect(brace.symbols.map((symbol) => symbol.name)).toContain("brace_generated");
    const path = extractRust(root, ["src/path.rs"]);
    expect(path.symbols.map((symbol) => symbol.name)).toContain("path_generated");
  });

  it("ignores invalid repetitions and malformed invocations", () => {
    const root = edgeProject();
    expect(extractRust(root, ["src/badrep.rs"]).symbols).toEqual([]);
    expect(extractRust(root, ["src/noargs.rs"]).symbols).toEqual([]);
    expect(extractRust(root, ["src/bad-invocation.rs"]).symbols).toEqual([]);
    expect(extractRust(root, ["src/unclosed-matcher.rs"]).symbols).toEqual([]);
    expect(extractRust(root, ["src/unclosed-body.rs"]).symbols).toEqual([]);
  });
});
