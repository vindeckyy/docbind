import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { extractJava } from "../src/surface/java.js";
import { tempProject } from "./helpers.js";

describe("Java surface", () => {
  it("extracts public types, methods, fields, and javadocs", () => {
    const root = tempProject({
      "src/main/java/example/Client.java": [
        "package example;",
        "",
        "/** Use {@link Client#status} and {@code Client#get}. */",
        "@Entity",
        "public class Client {",
        "    @Inject",
        "    public int status;",
        "    public static final int LIMIT = 1;",
        "",
        "    @Override",
        "    @Deprecated",
        "    public String get(int id, String label) throws Exception {",
        "        return label;",
        "    }",
        "",
        "    private void hidden() {}",
        "",
        "    protected void guarded() {}",
        "",
        "    void local() {}",
        "}",
        "",
        "class Internal {}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/main/java/example/Client.java"]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining(["Client", "get", "status"]));
    expect(result.symbols.find((symbol) => symbol.name === "hidden")?.shape.visibility).toBe("private");
    expect(result.symbols.find((symbol) => symbol.name === "guarded")?.shape.visibility).toBe("protected");
    expect(result.symbols.find((symbol) => symbol.name === "local")?.shape.visibility).toBe("package");
    expect(result.symbols.find((symbol) => symbol.name === "Internal")?.shape.visibility).toBe("package");
    const get = result.symbols.find((symbol) => symbol.name === "get");
    expect(get?.shape.params?.map((param) => [param.name, param.type])).toEqual([["id", "int"], ["label", "String"]]);
    expect(get?.shape.returnType).toBe("String");
    expect(get?.aliases).toEqual(expect.arrayContaining(["Client.get", "example.Client.get"]));
    expect(result.symbols.find((symbol) => symbol.name === "status")?.kind).toBe("property");
    expect(get?.contractFlags).toEqual(expect.arrayContaining(["deprecated"]));
    expect(get?.contractFlags.some((flag) => flag.startsWith("annotation:"))).toBe(false);
    expect(result.symbols.find((symbol) => symbol.name === "status")?.contractFlags).toContain("annotation:Inject");
    expect(result.symbols.find((symbol) => symbol.name === "Client")?.contractFlags).toContain("annotation:Entity");
    expect(result.javadocs?.[0]?.text).toContain("Client#status");
    expect(result.javadocs?.[0]?.owner).toBe("Client");
    expect(result.parseFailures).toBe(0);
  });

  it("handles interfaces, constructors, annotations, and varargs", () => {
    const root = tempProject({
      "src/main/java/example/Handler.java": [
        "package example;",
        "",
        "public interface Handler {",
        "    void handle(String value);",
        "}",
        "",
        "public class Client implements Handler {",
        "    public int status = 1;",
        "    public String[] names;",
        "",
        "    public Client() {}",
        "",
        "    public Client(int id) { this.status = id; }",
        "",
        "    @Override",
        "    public void handle(String value) {}",
        "",
        "    public <T> java.util.List<T> fetch(T input, String... rest) throws Exception {",
        "        return null;",
        "    }",
        "",
        "    private int hidden() { return 1; }",
        "",
        "    class Inner {}",
        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/main/java/example/Handler.java"]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining(["Handler", "Client", "handle", "fetch", "status", "names"]));
    const clients = result.symbols.filter((symbol) => symbol.name === "Client");
    expect(clients.filter((symbol) => symbol.kind === "class")).toHaveLength(1);
    expect(clients.filter((symbol) => symbol.kind === "method")).toHaveLength(2);
    expect(result.symbols.find((symbol) => symbol.name === "Handler")?.kind).toBe("interface");
    expect(result.symbols.find((symbol) => symbol.name === "fetch")?.shape.params?.map((param) => param.rest)).toEqual([
      false,
      true,
    ]);
    expect(result.symbols.find((symbol) => symbol.name === "hidden")?.shape.visibility).toBe("private");
    expect(result.symbols.find((symbol) => symbol.name === "Inner")?.shape.visibility).toBe("package");
  });

  it("handles generics, annotations, and missing packages", () => {
    const root = tempProject({
      "src/Generic.java": [
        "public class Generic {",
        "    private int hiddenField;",
        "    public java.util.List<String> values;",
        "",
        "    public void use(java.util.List<String> input, int[] ids, @Deprecated String old) {}",
        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/Generic.java"]);
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["Generic", "values", "use"]),
    );
    expect(result.symbols.find((symbol) => symbol.name === "use")?.shape.params?.map((param) => param.name)).toEqual([
      "input",
      "ids",
      "old",
    ]);
    expect(result.symbols.find((symbol) => symbol.name === "hiddenField")?.shape.visibility).toBe("private");
  });

  it("extracts public nested types with qualified aliases", () => {
    const root = tempProject({
      "src/main/java/example/Outer.java": [
        "package example;",
        "",
        "public class Outer {",
        "    public class Inner {",
        "        public String run() { return \"\"; }",
        "    }",
        "",
        "    public interface Nested {",
        "        void handle();",
        "    }",
        "",
        "    public @interface NestedMarker {",
        "        String value();",
        "    }",
        "",
        "    @interface Plain {}",
        "",
        "    private class HiddenInner {",
        "        public void hiddenRun() {}",
        "    }",
        "",
        "    protected class ProtectedInner {}",

        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/main/java/example/Outer.java"]);
    const outer = result.symbols.find((symbol) => symbol.name === "Outer");
    const inner = result.symbols.find((symbol) => symbol.name === "Inner");
    const run = result.symbols.find((symbol) => symbol.name === "run");
    expect(inner?.parentId).toBe(outer?.id);
    expect(inner?.aliases).toEqual(expect.arrayContaining(["Outer.Inner", "example.Outer.Inner"]));
    expect(run?.parentId).toBe(inner?.id);
    expect(run?.aliases).toEqual(expect.arrayContaining(["Outer.Inner.run", "Outer.Inner#run"]));
    expect(result.symbols.find((symbol) => symbol.name === "Nested")?.kind).toBe("interface");
    expect(result.symbols.find((symbol) => symbol.name === "NestedMarker")?.contractFlags).toContain("annotation-type");
    expect(result.symbols.find((symbol) => symbol.name === "Plain")?.contractFlags).toContain("annotation-type");
    expect(result.symbols.find((symbol) => symbol.name === "HiddenInner")?.shape.visibility).toBe("private");
    expect(result.symbols.some((symbol) => symbol.name === "hiddenRun")).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "ProtectedInner")?.shape.visibility).toBe("protected");
  });

  it("captures dotted and parameterized annotations", () => {
    const root = tempProject({
      "src/Annotated.java": [
        "@com.example.Audited",
        "@SuppressWarnings(\"unused\")",
        "@NoArgs",
        "@Empty()",
        "@Named(value = \"x\", count = 2)",
        "@Values({\"a,b\", \"c\"})",
        "@Typed(number = 42, flag = true, mode = Mode.FAST, type = Client.class)",
        "@Nested(inner = @Inner(level = 1, label = \"a)b,c\"), bare = @Bare, char = 'x', huge = 1e999, matrix = {{1,2},{3}})",
        "public class Annotated {",
        "    @Deprecated",
        "    public void old() {}",
        "}",
        "",
        "/** trailing comment */",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/Annotated.java"]);
    const type = result.symbols.find((symbol) => symbol.name === "Annotated");
    expect(type?.contractFlags).toContain("annotation:Audited");
    expect(type?.contractFlags).toContain('annotation:SuppressWarnings("unused")');
    expect(type?.contractFlags).toContain("annotation:NoArgs");
    const annotations = type?.shape.annotations ?? [];
    expect(annotations.find((annotation) => annotation.name === "SuppressWarnings")?.args).toEqual([
      { value: '"unused"', kind: "string", literal: "unused" },
    ]);
    expect(annotations.find((annotation) => annotation.name === "Named")?.args).toEqual([
      { name: "value", value: '"x"', kind: "string", literal: "x" },
      { name: "count", value: "2", kind: "number", literal: 2 },
    ]);
    expect(annotations.find((annotation) => annotation.name === "Values")?.args).toEqual([
      {
        value: '{"a,b", "c"}',
        kind: "array",
        items: [
          { value: '"a,b"', kind: "string", literal: "a,b" },
          { value: '"c"', kind: "string", literal: "c" },
        ],
      },
    ]);
    expect(annotations.find((annotation) => annotation.name === "Typed")?.args).toEqual([
      { name: "number", value: "42", kind: "number", literal: 42 },
      { name: "flag", value: "true", kind: "boolean", literal: true },
      { name: "mode", value: "Mode.FAST", kind: "enum", literal: "Mode.FAST" },
      { name: "type", value: "Client.class", kind: "class", literal: "Client" },
    ]);
    expect(annotations.find((annotation) => annotation.name === "Nested")?.args).toEqual([
      {
        name: "inner",
        value: '@Inner(level = 1, label = "a)b,c")',
        kind: "annotation",
        items: [
          { name: "level", value: "1", kind: "number", literal: 1 },
          { name: "label", value: '"a)b,c"', kind: "string", literal: "a)b,c" },
        ],
      },
      {
        name: "bare",
        value: "@Bare",
        kind: "annotation",
        items: [],
      },
      { name: "char", value: "'x'", kind: "string", literal: "x" },
      { name: "huge", value: "1e999", kind: "expression" },
      {
        name: "matrix",
        value: "{{1,2},{3}}",
        kind: "array",
        items: [
          { value: "{1,2}", kind: "array", items: [
            { value: "1", kind: "number", literal: 1 },
            { value: "2", kind: "number", literal: 2 },
          ] },
          { value: "{3}", kind: "array", items: [{ value: "3", kind: "number", literal: 3 }] },
        ],
      },
    ]);
    expect(type?.contractFlags).toContain("annotation:Empty");
    expect(result.symbols.find((symbol) => symbol.name === "old")?.contractFlags).toContain("deprecated");
    expect(result.javadocs?.some((entry) => entry.owner === undefined)).toBe(true);
    expect(() => extractJava(tempProject({ "src/Odd.java": "@123\npublic class Odd {}" }), ["src/Odd.java"])).not.toThrow();
  });

  it("exposes structured arguments on the corpus fixture", () => {
    const root = join(process.cwd(), "corpus/fixtures/java-javadoc");
    const result = extractJava(root, ["src/main/java/example/Client.java"]);
    const helper = result.symbols.find((symbol) => symbol.name === "helper");
    expect(helper?.shape.annotations).toEqual([
      { name: "SuppressWarnings", args: [{ value: '"unused"', kind: "string", literal: "unused" }] },
    ]);
    const command = result.symbols.find((symbol) => symbol.name === "command");
    expect(command?.shape.annotations).toEqual([
      {
        name: "Command",
        args: [
          { name: "value", value: '"run"', kind: "string", literal: "run" },
          { name: "retries", value: "2", kind: "number", literal: 2 },
          {
            name: "nested",
            value: "@Inner(level = 1)",
            kind: "annotation",
            items: [{ name: "level", value: "1", kind: "number", literal: 1 }],
          },
        ],
      },
    ]);
    const routes = result.symbols.find((symbol) => symbol.name === "routes");
    const fixtureColor = result.symbols.find((symbol) => symbol.name === "Color");
    expect(fixtureColor?.shape.enumMembers?.find((member) => member.name === "RED")?.argValues).toEqual([
      { value: '"red"', kind: "string", literal: "red" },
    ]);
    const red = result.symbols.find((symbol) => symbol.name === "RED");
    expect(red?.shape.kind).toBe("enumMember");
    expect(routes?.shape.annotations).toEqual([
      {
        name: "Routes",
        args: [
          {
            value: '{"/a", "/b"}',
            kind: "array",
            items: [
              { value: '"/a"', kind: "string", literal: "/a" },
              { value: '"/b"', kind: "string", literal: "/b" },
            ],
          },
        ],
      },
    ]);
  });

  it("resolves constants declared in another file", () => {
    const root = tempProject({
      "src/Marker.java": [
        "public @interface Marker {",
        "    String value() default Shared.NAME;",
        "}",
        "",
      ].join("\n"),
      "src/Shared.java": [
        "class Shared {",
        "    static final String NAME = \"shared\";",
        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/Marker.java", "src/Shared.java"], true);
    expect(result.symbols.find((symbol) => symbol.name === "value")?.shape.evaluatedDefault).toBe("shared");
    const off = extractJava(root, ["src/Marker.java", "src/Shared.java"]);
    expect(off.symbols.find((symbol) => symbol.name === "value")?.shape.evaluatedDefault).toBeUndefined();
  });

  it("skips parameter annotations and final modifiers", () => {
    const root = tempProject({
      "src/ParamKinds.java": [
        "public class ParamKinds {",
        "    public void run(final String a, @com.example.Marker(b = 1) String b, @123 String c, @Marker() String d) {}",
        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/ParamKinds.java"]);
    const run = result.symbols.find((symbol) => symbol.name === "run");
    expect(run?.shape.params?.map((param) => param.name)).toEqual(["a", "b", "c", "d"]);
    expect(run?.shape.params?.map((param) => param.type)).toEqual(["String", "String", "String", "String"]);
  });

  it("extracts annotation types and default values", () => {
    const root = tempProject({
      "src/Marker.java": [
        "package example;",
        "",
        "public @interface Marker {",
        "    String value() default \"x\";",
        "    int count() default 0;",
        "    boolean flag() default true;",
        "    Mode mode() default Mode.FAST;",
        "    String[] tags() default {\"a\", \"b\"};",
        "    Class<?> type() default String.class;",
        "    @Inner inner() default @Inner(level = 1);",
        "    @Inner positional() default @Inner(1);",
        "    @Inner bad() default @Inner(level = 1 + 2);",
        "    int[] empty() default {};",
        "    int calc() default 1 + 2;",
        "    int[] raw() default {1 + 2};",
        "    int sum() default 1 + 2 * 3;",
        "    int paren() default (1 + 2) * 3;",
        "    double half() default 7.0 / 2.0;",
        "    int neg() default -5 + 8;",
        "    String joined() default \"a\" + \"b\";",
        "    String mixed() default \"n=\" + Constants.LIMIT;",
        "    int idiv() default 7 / 2;",
        "    long ldiv() default 7L / 2L;",
        "    int constDiv() default Constants.LIMIT / 2;",
        "    int negDiv() default -7 / 2;",
        "    int mixedDiv() default 7.0 / 2.0;",
        "    int divZero() default 1 / 0;",
        "    String bad() default \"x\" +;",
        "    int sub() default 5 - 2;",
        "    int negStr() default -\"x\";",
        "    int mulBad() default \"a\" * 2;",
        "    int addBad() default 1 - \"a\";",
        "    double huge() default 1e999;",
        "    int at() default 1 + @;",
        "    int openParen() default (1 + 2;",
        "    int boolConst() default Constants.ON + 1;",
        "    String concatEscape() default \"a\\\"\" + \"b\";",
        "    int[] rawBad() default {1 + @};",
        "    @Inner innerBad() default @Inner(level = 1 + @);",
        "    String unclosed() default \"x + 1;",
        "    int dot() default 1 + .;",
        "    String fromConstant() default Constants.NAME;",
        "    String unqualified() default NAME;",
        "    int computed() default Constants.COMPUTED;",
        "    int limit() default Constants.LIMIT;",
        "    int halfConstant() default Constants.HALF;",
        "    long longHalfConstant() default Constants.LONG_HALF;",
        "    int negHalfConstant() default Constants.NEG_HALF;",
        "    boolean on() default Constants.ON;",
        "    String missing() default Missing.NAME;",
        "    String required();",
        "}",
        "",
        "class Constants {",
        "    static final String NAME = \"named\";",
        "    static final int LIMIT = 7;",
        "    static final boolean ON = true;",
        "    static final int UNINITIALIZED;",
        "    static final int COMPUTED = 1 + 2;",
        "    static final int HALF = 7 / 2;",
        "    static final long LONG_HALF = 7 / 2;",
        "    static final int NEG_HALF = -7 / 2;",
        "    transient int counter = 1;",
        "    static final int BAD = 1 + @;",
        "}",
        "",
        "enum Mode { FAST, SLOW }",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/Marker.java"], true);
    const marker = result.symbols.find((symbol) => symbol.name === "Marker");
    expect(marker?.kind).toBe("interface");
    expect(marker?.contractFlags).toContain("annotation-type");
    const value = result.symbols.find((symbol) => symbol.name === "value");
    expect(value?.shape.defaultValue).toBe('"x"');
    expect(value?.shape.defaultKind).toBe("string");
    expect(value?.shape.defaultLiteral).toBe("x");
    expect(result.symbols.find((symbol) => symbol.name === "count")?.shape.defaultValue).toBe("0");
    expect(result.symbols.find((symbol) => symbol.name === "count")?.shape.defaultLiteral).toBe(0);
    expect(result.symbols.find((symbol) => symbol.name === "flag")?.shape.defaultKind).toBe("boolean");
    expect(result.symbols.find((symbol) => symbol.name === "flag")?.shape.defaultLiteral).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "mode")?.shape.defaultKind).toBe("enum");
    expect(result.symbols.find((symbol) => symbol.name === "mode")?.shape.defaultLiteral).toBe("Mode.FAST");
    expect(result.symbols.find((symbol) => symbol.name === "tags")?.shape.defaultItems).toEqual([
      { value: '"a"', kind: "string", literal: "a" },
      { value: '"b"', kind: "string", literal: "b" },
    ]);
    expect(value?.shape.evaluatedDefault).toBe("x");
    expect(result.symbols.find((symbol) => symbol.name === "count")?.shape.evaluatedDefault).toBe(0);
    expect(result.symbols.find((symbol) => symbol.name === "flag")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "mode")?.shape.evaluatedDefault).toBe("Mode.FAST");
    expect(result.symbols.find((symbol) => symbol.name === "tags")?.shape.evaluatedDefault).toEqual(["a", "b"]);
    expect(result.symbols.find((symbol) => symbol.name === "type")?.shape.evaluatedDefault).toBe("String");
    expect(result.symbols.find((symbol) => symbol.name === "inner")?.shape.evaluatedDefault).toEqual({ level: 1 });
    expect(result.symbols.find((symbol) => symbol.name === "positional")?.shape.evaluatedDefault).toEqual({ arg0: 1 });
    expect(result.symbols.find((symbol) => symbol.name === "bad")?.shape.evaluatedDefault).toEqual({ level: 3 });
    expect(result.symbols.find((symbol) => symbol.name === "sub")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "concatEscape")?.shape.evaluatedDefault).toBe('a"b');
    for (const name of ["negStr", "mulBad", "addBad", "huge", "at", "openParen", "boolConst", "rawBad", "innerBad"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    expect(result.symbols.find((symbol) => symbol.name === "unclosed")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "dot")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "fromConstant")?.shape.evaluatedDefault).toBe("named");
    expect(result.symbols.find((symbol) => symbol.name === "unqualified")?.shape.evaluatedDefault).toBe("named");
    expect(result.symbols.find((symbol) => symbol.name === "computed")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "limit")?.shape.evaluatedDefault).toBe(7);
    expect(result.symbols.find((symbol) => symbol.name === "halfConstant")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "longHalfConstant")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "negHalfConstant")?.shape.evaluatedDefault).toBe(-3);
    expect(result.symbols.find((symbol) => symbol.name === "on")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "missing")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "empty")?.shape.evaluatedDefault).toEqual([]);
    expect(result.symbols.find((symbol) => symbol.name === "calc")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "raw")?.shape.evaluatedDefault).toEqual([3]);
    expect(result.symbols.find((symbol) => symbol.name === "sum")?.shape.evaluatedDefault).toBe(7);
    expect(result.symbols.find((symbol) => symbol.name === "paren")?.shape.evaluatedDefault).toBe(9);
    expect(result.symbols.find((symbol) => symbol.name === "half")?.shape.evaluatedDefault).toBe(3.5);
    expect(result.symbols.find((symbol) => symbol.name === "neg")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "joined")?.shape.evaluatedDefault).toBe("ab");
    expect(result.symbols.find((symbol) => symbol.name === "mixed")?.shape.evaluatedDefault).toBe("n=7");
    expect(result.symbols.find((symbol) => symbol.name === "idiv")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "ldiv")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "constDiv")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "negDiv")?.shape.evaluatedDefault).toBe(-3);
    expect(result.symbols.find((symbol) => symbol.name === "mixedDiv")?.shape.evaluatedDefault).toBe(3.5);
    expect(result.symbols.find((symbol) => symbol.name === "divZero")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "bad")?.shape.evaluatedDefault).toEqual({ level: 3 });
    expect(result.symbols.find((symbol) => symbol.name === "sub")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "concatEscape")?.shape.evaluatedDefault).toBe('a"b');
    for (const name of ["negStr", "mulBad", "addBad", "huge", "at", "openParen", "boolConst", "rawBad", "innerBad"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    expect(result.symbols.find((symbol) => symbol.name === "unclosed")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "dot")?.shape.evaluatedDefault).toBeUndefined();
    const off = extractJava(root, ["src/Marker.java"]);
    expect(off.symbols.find((symbol) => symbol.name === "value")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "required")?.shape.defaultValue).toBeUndefined();
  });

  it("extracts enum constants with aliases", () => {
    const root = tempProject({
      "src/Color.java": [
        "package example;",
        "",
        "public enum Color {",
        "    @Deprecated",
        "    @Marker(\"x\")",
        "    RED(\"red\", 2, true),",
        "    GREEN(),",
        "    BLUE {",
        "        public String label() { return \"b\"; }",
        "    };",
        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/Color.java"]);
    const color = result.symbols.find((symbol) => symbol.name === "Color");
    expect(color?.kind).toBe("enum");
    expect(color?.shape.enumMembers?.map((member) => member.name)).toEqual(["RED", "GREEN", "BLUE"]);
    expect(color?.shape.enumMembers?.find((member) => member.name === "GREEN")?.args).toBeUndefined();
    const red = result.symbols.find((symbol) => symbol.name === "RED");
    expect(red?.kind).toBe("enumMember");
    expect(red?.parentId).toBe(color?.id);
    expect(red?.aliases).toEqual(expect.arrayContaining(["Color.RED", "Color#RED", "example.Color.RED"]));
    expect(red?.shape.enumArgs).toEqual([
      { value: '"red"', kind: "string", literal: "red" },
      { value: "2", kind: "number", literal: 2 },
      { value: "true", kind: "boolean", literal: true },
    ]);
    const blue = result.symbols.find((symbol) => symbol.name === "BLUE");
    const label = result.symbols.find((symbol) => symbol.name === "label");
    expect(label?.parentId).toBe(blue?.id);
    expect(label?.aliases).toEqual(expect.arrayContaining(["Color.BLUE.label", "Color.BLUE#label"]));
    expect(color?.shape.enumMembers?.map((member) => member.args)).toEqual(['"red", 2, true', undefined, undefined]);
    expect(color?.shape.enumMembers?.find((member) => member.name === "RED")?.argValues).toEqual([
      { value: '"red"', kind: "string", literal: "red" },
      { value: "2", kind: "number", literal: 2 },
      { value: "true", kind: "boolean", literal: true },
    ]);
  });

  it("survives malformed files", () => {
    const root = tempProject({
      "src/Broken.java": "public class Broken { public void run( {",
      "src/NoBrace.java": "public class NoBrace",
      "src/BadName.java": "public class 123 {}",
      "src/BadString.java": 'public class BadString { String value = "unterminated;',
      "src/Unclosed.java": "public class Unclosed { public void run() {",
      "src/UnclosedEnum.java": "public enum UnclosedEnum { A(param {",
      "src/UnclosedEnumArgs.java": "public enum UnclosedEnumArgs { A(1, 2 }",
      "src/UnclosedEnumBody.java": "public enum UnclosedEnumBody { A {",
      "src/UnclosedEnumAnnotation.java": "public enum UnclosedEnumAnnotation { @Marker(\"x\" A }",
      "src/MissingAnnotation.java": "@123 public class MissingAnnotation { @456 public void run() {} }",
      "src/UnclosedAnnotation.java": "@Marker(value = \"x\" public class UnclosedAnnotation {}",
      "src/UnclosedMethod.java": "public class UnclosedMethod { public void run( }",
      "src/UnclosedBody.java": "public class UnclosedBody { public void run() {",
      "src/EndTokens.java": "public class EndTokens { public }",
      "src/NoSemiDefault.java": "public @interface NoSemiDefault { int count() default 42 }",
      "src/TrailingEnum.java": "public enum TrailingEnum { A, @Trailing; }",
      "src/NumberEnum.java": "public enum NumberEnum { A, 1; }",
      "src/AtEnd.java": "@",
      "src/DotEnd.java": "@A.",
      "src/NoParams.java": "public class NoParams { public void run(&&) {} }",
      "src/NoName.java": "public class NoName { public () {} }",
      "src/NoField.java": "public class NoField { public ; }",
      "src/LoneAtParam.java": "public class LoneAtParam { public void run(@) {} }",
    });
    expect(() =>
      extractJava(root, [
        "src/Broken.java",
        "src/NoBrace.java",
        "src/BadName.java",
        "src/BadString.java",
        "src/Unclosed.java",
        "src/UnclosedEnum.java",
        "src/UnclosedEnumArgs.java",
        "src/UnclosedEnumBody.java",
        "src/UnclosedEnumAnnotation.java",
        "src/MissingAnnotation.java",
        "src/UnclosedAnnotation.java",
        "src/UnclosedMethod.java",
        "src/UnclosedBody.java",
        "src/EndTokens.java",
        "src/NoSemiDefault.java",
        "src/TrailingEnum.java",
        "src/NumberEnum.java",
        "src/AtEnd.java",
        "src/DotEnd.java",
        "src/NoParams.java",
        "src/NoName.java",
        "src/NoField.java",
        "src/LoneAtParam.java",
      ])
    ).not.toThrow();
  });
});
