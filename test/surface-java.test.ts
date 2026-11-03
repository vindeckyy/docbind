import { describe, expect, it } from "vitest";
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
    expect(result.symbols.find((symbol) => symbol.name === "old")?.contractFlags).toContain("deprecated");
    expect(result.javadocs?.some((entry) => entry.owner === undefined)).toBe(true);
    expect(() => extractJava(tempProject({ "src/Odd.java": "@123\npublic class Odd {}" }), ["src/Odd.java"])).not.toThrow();
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
