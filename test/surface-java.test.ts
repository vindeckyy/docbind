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
        "    String required();",
        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/Marker.java"]);
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
    expect(result.symbols.find((symbol) => symbol.name === "required")?.shape.defaultValue).toBeUndefined();
  });

  it("extracts enum constants with aliases", () => {
    const root = tempProject({
      "src/Color.java": [
        "package example;",
        "",
        "public enum Color {",
        "    @Deprecated RED,",
        "    GREEN(\"g\"),",
        "    BLUE {",
        "        public String label() { return \"b\"; }",
        "    }",
        "}",
        "",
      ].join("\n"),
    });
    const result = extractJava(root, ["src/Color.java"]);
    const color = result.symbols.find((symbol) => symbol.name === "Color");
    expect(color?.kind).toBe("enum");
    expect(color?.shape.enumMembers?.map((member) => member.name)).toEqual(["RED", "GREEN", "BLUE"]);
    const red = result.symbols.find((symbol) => symbol.name === "RED");
    expect(red?.kind).toBe("enumMember");
    expect(red?.parentId).toBe(color?.id);
    expect(red?.aliases).toEqual(expect.arrayContaining(["Color.RED", "Color#RED", "example.Color.RED"]));
  });

  it("survives malformed files", () => {
    const root = tempProject({
      "src/Broken.java": "public class Broken { public void run( {",
      "src/NoBrace.java": "public class NoBrace",
      "src/BadName.java": "public class 123 {}",
      "src/BadString.java": 'public class BadString { String value = "unterminated;',
      "src/Unclosed.java": "public class Unclosed { public void run() {",
    });
    expect(() =>
      extractJava(root, [
        "src/Broken.java",
        "src/NoBrace.java",
        "src/BadName.java",
        "src/BadString.java",
        "src/Unclosed.java",
      ])
    ).not.toThrow();
  });
});
