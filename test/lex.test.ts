import { describe, expect, it } from "vitest";
import { lex } from "../src/surface/lex.js";

function values(source: string, language: "rust" | "go"): string[] {
  return lex(source, language).tokens.map((token) => token.value);
}

describe("shared lexer", () => {
  it("masks rust comments, strings, chars and lifetimes", () => {
    const source = [
      'let text = "a // not a comment";',
      "// real comment",
      "/* outer /* nested */ done */",
      "let raw = r#\"raw } text\"#;",
      "let byte = b\"bytes\";",
      "fn f<'a>(value: &'a str, letter: char) -> &'a str {",
      "  let c = 'x';",
      "  value",
      "}",
    ].join("\n");
    const result = lex(source, "rust");
    expect(result.error).toBe(false);
    expect(result.tokens.map((token) => token.value)).toEqual(expect.arrayContaining([
      "fn", "f", "'", "a", "value", "letter", "c",
    ]));
    expect(result.masked).not.toContain("not a comment");
    expect(result.masked).not.toContain("raw } text");
    expect(result.masked).not.toContain("bytes");
    expect(result.tokens.map((token) => token.value)).not.toContain("real");
  });

  it("masks go strings, runes and comments", () => {
    const source = [
      'var text = "hello // world"',
      "// comment",
      "var raw = `line one",
      "line two`",
      "var r = 'x'",
      "func F(a int) <-chan string { return nil }",
      "x := 1",
      "items := []int{1, 2, 3}",
    ].join("\n");
    const result = lex(source, "go");
    expect(result.tokens.map((token) => token.value)).toEqual(expect.arrayContaining([
      "func", "F", "a", "int", "<-", "chan", "string", ":=",
    ]));
    expect(result.masked).not.toContain("hello // world");
    expect(result.masked).not.toContain("line one");
    expect(result.tokens.map((token) => token.value)).not.toContain("comment");
    expect(lex("func F(items ...int) {}", "go").tokens.map((token) => token.value)).toContain("...");
  });

  it("reports unterminated constructs", () => {
    expect(lex('let x = "open', "rust").error).toBe(true);
    expect(lex("let x = r#\"open", "rust").error).toBe(true);
    expect(lex("/* open", "rust").error).toBe(true);
    expect(lex("var x = `open", "go").error).toBe(true);
  });

  it("handles raw strings, escapes and comment boundaries", () => {
    expect(lex("let a = r##\"x\"##; let b = br#\"y\"#;", "rust").error).toBe(false);
    expect(lex("let a = b'x';", "rust").tokens.map((token) => token.value)).toEqual(expect.arrayContaining(["b"]));
    expect(lex("let a = '\\'';", "rust").error).toBe(false);
    expect(lex("// eof", "rust").error).toBe(false);
    expect(lex("/* open /* nested */", "rust").error).toBe(true);
    expect(lex("var s = \"open", "go").error).toBe(true);
    expect(lex("var r = '\\n'", "go").error).toBe(false);
    expect(lex("a >> b", "rust").tokens.map((token) => token.value)).toEqual(expect.arrayContaining([">", ">"]));
    expect(lex("const café = 1", "rust").tokens.map((token) => token.value)).toContain("café");
  });

  it("tokenizes numbers and multi-character operators", () => {
    expect(values("x := 0x1f + 3.14; a...b; a::b; a->b", "go")).toEqual(expect.arrayContaining([
      "0x1f", "3.14", "...", "::", "->", ":=",
    ]));
  });
});
