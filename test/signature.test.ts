import { describe, expect, it } from "vitest";
import { parseSignatureText } from "../src/surface/signature.js";

describe("SCIP signature parsing", () => {
  it("parses TypeScript parameters and return types", () => {
    const shape = parseSignatureText("export function getUser(id: string, opts?: { fast: boolean }): string", "function");
    expect(shape?.returnType).toBe("string");
    expect(shape?.params).toEqual([
      { name: "id", type: "string", optional: false, rest: false, hasDefault: false, kind: "positional" },
      { name: "opts", type: "{ fast: boolean }", optional: true, rest: false, hasDefault: false, kind: "positional" },
    ]);
  });

  it("parses Java, Python, Go, and Rust forms", () => {
    expect(parseSignatureText("public String getUser(int id)", "method")).toMatchObject({
      returnType: "String",
      params: [{ name: "id", type: "int" }],
    });
    expect(parseSignatureText("def get_response(url: str, timeout: int = 10) -> Response:", "function")).toMatchObject({
      returnType: "Response",
      params: [{ name: "url", type: "str" }, { name: "timeout", type: "int", hasDefault: true }],
    });
    expect(parseSignatureText("func Get(key string, extra int) (string, error)", "function")).toMatchObject({
      returnType: "string,error",
      params: [{ name: "key", type: "string" }, { name: "extra", type: "int" }],
    });
    expect(parseSignatureText("pub fn request(&self, path: &str) -> String", "method")).toMatchObject({
      returnType: "String",
      params: [{ name: "path", type: "&str" }],
    });
  });

  it("handles rest parameters and signatures without parens", () => {
    const rest = parseSignatureText("function log(...args: string[]): void", "function");
    expect(rest?.params?.[0]).toMatchObject({ name: "args", type: "string[]", rest: true });
    expect(parseSignatureText("const value: string", "const")).toBeUndefined();
  });

  it("covers empty, unclosed, untyped, and trailing-comma forms", () => {
    expect(parseSignatureText("function noop(): void", "function")).toMatchObject({ params: [], returnType: "void" });
    expect(parseSignatureText("function broken(a: string", "function")).toBeUndefined();
    expect(parseSignatureText("function f(int)", "function")?.params?.[0]).toMatchObject({ type: "int" });
    expect(parseSignatureText("function f(a: string,)", "function")?.params).toHaveLength(1);
    expect(parseSignatureText("function f(a: string = 'x')", "function")?.params?.[0]).toMatchObject({
      name: "a",
      type: "string",
      hasDefault: true,
    });
    expect(parseSignatureText("function f()", "function")?.returnType).toBeUndefined();
    expect(parseSignatureText("function f(a: string)", "function")?.returnType).toBeUndefined();
    expect(parseSignatureText("function f(map<string, int> value)", "function")?.params?.[0]).toMatchObject({
      name: "value",
      type: "map<string, int>",
    });
    expect(parseSignatureText("function f(a)", "function")?.params?.[0]).toMatchObject({ type: "a" });
  });
});

describe("SCIP signature parity", () => {
  it("handles nested generics", () => {
    const ts = parseSignatureText("export async function fetchUser(id: string, opts?: { retries: number }): Promise<User>", "function");
    expect(ts?.returnType).toBe("Promise<User>");
    expect(ts?.params?.[1]).toMatchObject({ name: "opts", type: "{ retries: number }", optional: true });
    const java = parseSignatureText(
      "public <T extends Comparable<T>> Map<String, List<T>> group(List<T> values, int limit, String... tags) throws IOException",
      "method",
    );
    expect(java?.returnType).toBe("Map<String, List<T>>");
    expect(java?.params?.[0]).toMatchObject({ name: "values", type: "List<T>" });
    expect(java?.params?.[2]).toMatchObject({ name: "tags", type: "String..." });
  });

  it("handles C pointers, arrays, and function pointers", () => {
    const c = parseSignatureText("static char *const *get_names(const char *path, int flags)", "function");
    expect(c?.returnType).toBe("char *const *");
    expect(c?.params).toEqual([
      { name: "path", type: "const char *", optional: false, rest: false, hasDefault: false, kind: "positional" },
      { name: "flags", type: "int", optional: false, rest: false, hasDefault: false, kind: "positional" },
    ]);
    const callback = parseSignatureText("void set_callback(void (*cb)(int), void *user_data)", "function");
    expect(callback?.params?.[0]).toMatchObject({ name: "cb", type: "void (*)(int)" });
    expect(callback?.params?.[1]).toMatchObject({ name: "user_data", type: "void *" });
    expect(parseSignatureText("void fill(char argv[])", "function")?.params?.[0]).toMatchObject({
      name: "argv",
      type: "char[]",
    });
  });

  it("handles Python rest/kwargs and Rust results", () => {
    const python = parseSignatureText("def call(url: str, *args: int, **kwargs: Any) -> Response:", "function");
    expect(python?.returnType).toBe("Response");
    expect(python?.params?.[1]).toMatchObject({ name: "args", type: "int", rest: true });
    expect(python?.params?.[2]).toMatchObject({ name: "kwargs", type: "Any", rest: true });
    const rust = parseSignatureText("pub fn load<'a>(path: &'a str) -> Result<Config, Error>", "function");
    expect(rust?.returnType).toBe("Result<Config, Error>");
  });
});
