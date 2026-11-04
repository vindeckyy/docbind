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
        "    int dot() default 1 + .;",
        "    String fromConstant() default Constants.NAME;",
        "    String unqualified() default NAME;",
        "    int computed() default Constants.COMPUTED;",
        "    int limit() default Constants.LIMIT;",
        "    int boxed() default Constants.BOXED;",
        "    long boxedLong() default Constants.BOXED_LONG;",
        "    int boxedMath() default Constants.BOXED + 1;",
        "    int halfConstant() default Constants.HALF;",
        "    double widened() default Constants.WIDENED;",
        "    double castDiv() default (double) 7 / 2;",
        "    int castTrunc() default (int) 3.9;",
        "    int castGroup() default (int) (7.0 / 2.0);",
        "    double castIntDiv() default (double) (7 / 2);",
        "    int castBad() default (int) \"x\";",
        "    long castHuge() default (long) (1L << 62);",
        "    int castHugeInt() default (int) (1L << 62);",
        "    long castFloat() default (long) 3.9;",
        "    long castEmpty() default (long);",
        "    double castString() default (double) \"x\";",
        "    double floatMul() default 1.0 * 2;",
        "    double mulMissing() default 1.0 *;",
        "    double floatDivZero() default 1.0 / 0.0;",
        "    double floatSub() default 3.0 - 1.0;",
        "    int mathMax() default Math.max(3, 7);",
        "    int mathMin() default Math.min(3, 7);",
        "    int mathAbs() default Math.abs(-9);",
        "    long mathLong() default Math.max(3L, 1L << 40);",
        "    double mathDouble() default Math.max(1.5, 2);",
        "    int mathBad() default Math.max(1);",
        "    int mathUnknown() default Math.pow(2, 3);",
        "    double mathAbsDouble() default Math.abs(-2.5);",
        "    int mathAbsPos() default Math.abs(4);",
        "    double mathMinDouble() default Math.min(1.5, 3);",
        "    int mathOpen() default Math.max(1;",
        "    int mathEmpty() default Math.max(1, );",
        "    int mathAbsBad() default Math.abs(\"x\");",
        "    int mathString() default Math.max(\"a\", 1);",
        "    int mathNoComma() default Math.max(1 2);",
        "    long mathRound() default Math.round(3.6);",
        "    int mathRoundNeg() default (int) Math.round(-2.5);",
        "    double mathFloor() default Math.floor(3.9);",
        "    double mathCeil() default Math.ceil(3.1);",
        "    double mathFloorInt() default Math.floor(5);",
        "    int mathRoundBad() default Math.round();",
        "    long mathRoundLong() default Math.round(1L << 40);",
        "    int mathRoundString() default Math.round(\"x\");",
        "    double mathSqrt() default Math.sqrt(9);",
        "    double mathSqrtFrac() default Math.sqrt(2);",
        "    double mathPow() default Math.pow(2, 10);",
        "    double mathPowNeg() default Math.pow(2, -1);",
        "    int mathSqrtNeg() default (int) Math.sqrt(-1);",
        "    double mathPowHuge() default Math.pow(10, 400);",
        "    double mathPowBad() default Math.pow(2);",
        "    double mathSqrtBad() default Math.sqrt(1, 2);",
        "    String refString() default (String) \"x\";",
        "    CharSequence refChars() default (CharSequence) \"y\";",
        "    Object refObject() default (Object) 5;",
        "    Number refNumber() default (Number) 5;",
        "    Boolean refBool() default (Boolean) true;",
        "    Integer refInteger() default (Integer) 5;",
        "    Long refLong() default (Long) 5;",
        "    Short refShort() default (Short) 5;",
        "    Byte refByte() default (Byte) 5;",
        "    Double refDouble() default (Double) 5;",
        "    Float refFloat() default (Float) 5;",
        "    String refBad() default (String) 5;",
        "    Number refNumberBad() default (Number) \"x\";",
        "    Boolean refBoolBad() default (Boolean) 5;",
        "    String refEmpty() default (String);",
        "    Integer refIntegerBad() default (Integer) \"x\";",
        "    Long refLongBad() default (Long) \"x\";",
        "    Double refDoubleBad() default (Double) \"x\";",
        "    double mathPowExpLong() default Math.pow(1, 1L << 62);",
        "    int strLen() default \"hello\".length();",
        "    boolean strEmpty() default \"\".isEmpty();",
        "    boolean strNotEmpty() default \"x\".isEmpty();",
        "    char charCast() default (char) 65;",
        "    char charFloat() default (char) 66.9;",
        "    Character charBox() default (Character) 'x';",
        "    Character escapedChar() default (Character) '\\n';",
        "    int charBad() default (Character) \"xy\";",
        "    int charCastBad() default (char) \"x\";",
        "    int strUnknown() default \"x\".hashCode();",
        "    int strChain() default \"x\".trim().length();",
        "    boolean startsYes() default \"hello\".startsWith(\"he\");",
        "    boolean startsNo() default \"hello\".startsWith(\"lo\");",
        "    boolean endsYes() default \"hello\".endsWith(\"lo\");",
        "    String subOne() default \"hello\".substring(1);",
        "    String subTwo() default \"hello\".substring(1, 3);",
        "    String subBadOrder() default \"hello\".substring(4, 2);",
        "    String subBadRange() default \"hello\".substring(0, 99);",
        "    boolean startsBad() default \"hello\".startsWith(1);",
        "    int subNoArgs() default \"hello\".substring();",
        "    boolean startsArity() default \"hello\".startsWith(\"a\", \"b\");",
        "    boolean constStarts() default Constants.NAME.startsWith(\"na\");",
        "    boolean constEnds() default Constants.NAME.endsWith(\"ed\");",
        "    String constSub() default Constants.NAME.substring(0, 3);",
        "    int constChain() default Constants.NAME.substring(1).length();",
        "    boolean constBad() default Constants.LIMIT.startsWith(\"1\");",
        "    String constSubOob() default Constants.NAME.substring(0, 99);",
        "    int plainCall() default max(1, 2);",
        "    int numMethod() default (5).length();",
        "    int idx() default \"hello\".indexOf(\"ll\");",
        "    int idxMissing() default \"hello\".indexOf(\"z\");",
        "    String repl() default \"a-b-c\".replace(\"-\", \"+\");",
        "    int idxConst() default Constants.NAME.indexOf(\"am\");",
        "    String replConst() default Constants.NAME.replace(\"n\", \"N\");",
        "    int idxBad() default \"x\".indexOf(1);",
        "    String replBad() default \"x\".replace(\"x\");",
        "    String replBadType() default \"x\".replace(\"x\", 1);",
        "    String trimmed() default \"  x  \".trim();",
        "    String upper() default \"abc\".toUpperCase();",
        "    String lower() default \"ABC\".toLowerCase();",
        "    String firstChar() default \"hello\".charAt(1);",
        "    String firstConstChar() default Constants.NAME.charAt(0);",
        "    String charOob() default \"x\".charAt(5);",
        "    String charBad() default \"x\".charAt(\"a\");",
        "    String upperArgs() default \"x\".toUpperCase(1);",
        "    String subFloat() default \"hello\".substring(1.5);",
        "    String subEmptyArg() default \"hello\".substring(1, );",
        "    String subNoComma() default \"hello\".substring(1 2);",
        "    double mathSqrtLong() default Math.sqrt(1L << 62);",
        "    double mathPowLong() default Math.pow(1L << 62, 1);",
        "    int bitsAnd() default 6 & 3;",
        "    int bitsOr() default 4 | 1;",
        "    int bitsXor() default 6 ^ 3;",
        "    int shiftLeft() default 1 << 3;",
        "    int shiftRight() default -8 >> 2;",
        "    int shiftUnsigned() default -1 >>> 28;",
        "    int bitPrec() default 1 + 2 << 3;",
        "    int bitFloat() default 1.0 & 1;",
        "    int shiftFloat() default 1 << 1.0;",
        "    int bitString() default \"a\" & 1;",
        "    int comparison() default 1 < 2;",
        "    long longShift() default 1L << 40;",
        "    long longMask() default 0x1FFFFFFFFL & 0xFFFFFFFFL;",
        "    long longOr() default 0x100000000L | 1L;",
        "    long longXor() default 0x1FFFFFFFFL ^ 0xFFFFFFFFL;",
        "    long longUnsigned() default -1L >>> 32;",
        "    long longAdd() default 0x100000000L + 2L;",
        "    long longDiv() default 0x100000000L / 2L;",
        "    long longMul() default 0x100000000L * 2L;",
        "    long longSub() default 0x100000000L - 2L;",
        "    long longRight() default -8L >> 2;",
        "    long longHuge() default (1L << 62) + 1L;",
        "    double floatAdd() default 1.0 + 2;",
        "    double wdiv() default 7 / 2;",
        "    double floatDiv() default Constants.FLOAT_DIV;",
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
        "    static final Integer BOXED = 7 / 2;",
        "    static final Long BOXED_LONG = 1L << 40;",
        "    static final int HALF = 7 / 2;",
        "    static final long LONG_HALF = 7 / 2;",
        "    static final int NEG_HALF = -7 / 2;",
        "    static final double WIDENED = 7 / 2;",
        "    static final double FLOAT_DIV = 7.0 / 2;",
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
    expect(result.symbols.find((symbol) => symbol.name === "dot")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "fromConstant")?.shape.evaluatedDefault).toBe("named");
    expect(result.symbols.find((symbol) => symbol.name === "unqualified")?.shape.evaluatedDefault).toBe("named");
    expect(result.symbols.find((symbol) => symbol.name === "computed")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "limit")?.shape.evaluatedDefault).toBe(7);
    expect(result.symbols.find((symbol) => symbol.name === "boxed")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "boxedLong")?.shape.evaluatedDefault).toBe(1099511627776);
    expect(result.symbols.find((symbol) => symbol.name === "boxedMath")?.shape.evaluatedDefault).toBe(4);
    expect(result.symbols.find((symbol) => symbol.name === "halfConstant")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "widened")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "wdiv")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "floatDiv")?.shape.evaluatedDefault).toBe(3.5);
    expect(result.symbols.find((symbol) => symbol.name === "castDiv")?.shape.evaluatedDefault).toBe(3.5);
    expect(result.symbols.find((symbol) => symbol.name === "castTrunc")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "castGroup")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "castIntDiv")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "castBad")?.shape.evaluatedDefault).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "castHuge")?.shape.evaluatedDefault).toBe("4611686018427387904");
    expect(result.symbols.find((symbol) => symbol.name === "castHugeInt")?.shape.evaluatedDefault).toBe(0);
    expect(result.symbols.find((symbol) => symbol.name === "castFloat")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "floatMul")?.shape.evaluatedDefault).toBe(2);
    expect(result.symbols.find((symbol) => symbol.name === "floatSub")?.shape.evaluatedDefault).toBe(2);
    expect(result.symbols.find((symbol) => symbol.name === "mathMax")?.shape.evaluatedDefault).toBe(7);
    expect(result.symbols.find((symbol) => symbol.name === "mathMin")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "mathAbs")?.shape.evaluatedDefault).toBe(9);
    expect(result.symbols.find((symbol) => symbol.name === "mathLong")?.shape.evaluatedDefault).toBe(1099511627776);
    expect(result.symbols.find((symbol) => symbol.name === "mathDouble")?.shape.evaluatedDefault).toBe(2);
    expect(result.symbols.find((symbol) => symbol.name === "mathAbsDouble")?.shape.evaluatedDefault).toBe(2.5);
    expect(result.symbols.find((symbol) => symbol.name === "mathAbsPos")?.shape.evaluatedDefault).toBe(4);
    expect(result.symbols.find((symbol) => symbol.name === "mathMinDouble")?.shape.evaluatedDefault).toBe(1.5);
    expect(result.symbols.find((symbol) => symbol.name === "mathRound")?.shape.evaluatedDefault).toBe(4);
    expect(result.symbols.find((symbol) => symbol.name === "mathRoundNeg")?.shape.evaluatedDefault).toBe(-2);
    expect(result.symbols.find((symbol) => symbol.name === "mathFloor")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "mathCeil")?.shape.evaluatedDefault).toBe(4);
    expect(result.symbols.find((symbol) => symbol.name === "mathFloorInt")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "mathRoundLong")?.shape.evaluatedDefault).toBe(1099511627776);
    expect(result.symbols.find((symbol) => symbol.name === "mathSqrt")?.shape.evaluatedDefault).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === "mathSqrtFrac")?.shape.evaluatedDefault).toBe(Math.sqrt(2));
    expect(result.symbols.find((symbol) => symbol.name === "mathPow")?.shape.evaluatedDefault).toBe(1024);
    expect(result.symbols.find((symbol) => symbol.name === "mathPowNeg")?.shape.evaluatedDefault).toBe(0.5);
    expect(result.symbols.find((symbol) => symbol.name === "mathSqrtLong")?.shape.evaluatedDefault).toBe(2147483648);
    expect(result.symbols.find((symbol) => symbol.name === "mathPowLong")?.shape.evaluatedDefault).toBe(4611686018427388000);
    expect(result.symbols.find((symbol) => symbol.name === "refString")?.shape.evaluatedDefault).toBe("x");
    expect(result.symbols.find((symbol) => symbol.name === "refChars")?.shape.evaluatedDefault).toBe("y");
    expect(result.symbols.find((symbol) => symbol.name === "refObject")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "refNumber")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "refBool")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "refInteger")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "refLong")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "refShort")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "refByte")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "refDouble")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "refFloat")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "mathPowExpLong")?.shape.evaluatedDefault).toBe(1);
    expect(result.symbols.find((symbol) => symbol.name === "strLen")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "strEmpty")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "strNotEmpty")?.shape.evaluatedDefault).toBe(false);
    expect(result.symbols.find((symbol) => symbol.name === "charCast")?.shape.evaluatedDefault).toBe("A");
    expect(result.symbols.find((symbol) => symbol.name === "charFloat")?.shape.evaluatedDefault).toBe("B");
    expect(result.symbols.find((symbol) => symbol.name === "charBox")?.shape.evaluatedDefault).toBe("x");
    expect(result.symbols.find((symbol) => symbol.name === "escapedChar")?.shape.evaluatedDefault).toBe("\n");
    expect(result.symbols.find((symbol) => symbol.name === "startsYes")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "startsNo")?.shape.evaluatedDefault).toBe(false);
    expect(result.symbols.find((symbol) => symbol.name === "endsYes")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "subOne")?.shape.evaluatedDefault).toBe("ello");
    expect(result.symbols.find((symbol) => symbol.name === "subTwo")?.shape.evaluatedDefault).toBe("el");
    expect(result.symbols.find((symbol) => symbol.name === "constStarts")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "constEnds")?.shape.evaluatedDefault).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "constSub")?.shape.evaluatedDefault).toBe("nam");
    expect(result.symbols.find((symbol) => symbol.name === "constChain")?.shape.evaluatedDefault).toBe(4);
    expect(result.symbols.find((symbol) => symbol.name === "idx")?.shape.evaluatedDefault).toBe(2);
    expect(result.symbols.find((symbol) => symbol.name === "idxMissing")?.shape.evaluatedDefault).toBe(-1);
    expect(result.symbols.find((symbol) => symbol.name === "repl")?.shape.evaluatedDefault).toBe("a+b+c");
    expect(result.symbols.find((symbol) => symbol.name === "idxConst")?.shape.evaluatedDefault).toBe(1);
    expect(result.symbols.find((symbol) => symbol.name === "replConst")?.shape.evaluatedDefault).toBe("Named");
    expect(result.symbols.find((symbol) => symbol.name === "trimmed")?.shape.evaluatedDefault).toBe("x");
    expect(result.symbols.find((symbol) => symbol.name === "upper")?.shape.evaluatedDefault).toBe("ABC");
    expect(result.symbols.find((symbol) => symbol.name === "lower")?.shape.evaluatedDefault).toBe("abc");
    expect(result.symbols.find((symbol) => symbol.name === "firstChar")?.shape.evaluatedDefault).toBe("e");
    expect(result.symbols.find((symbol) => symbol.name === "firstConstChar")?.shape.evaluatedDefault).toBe("n");
    for (const name of ["charOob", "charBad", "upperArgs"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    for (const name of ["idxBad", "replBad", "replBadType"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    for (const name of ["constBad", "constSubOob", "plainCall", "numMethod"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    for (const name of [
      "subBadOrder",
      "subBadRange",
      "startsBad",
      "subNoArgs",
      "startsArity",
      "subFloat",
      "subEmptyArg",
      "subNoComma",
    ]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    expect(result.symbols.find((symbol) => symbol.name === "strChain")?.shape.evaluatedDefault).toBe(1);
    for (const name of ["charBad", "charCastBad", "strUnknown"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    for (const name of [
      "refBad",
      "refNumberBad",
      "refBoolBad",
      "refEmpty",
      "refIntegerBad",
      "refLongBad",
      "refDoubleBad",
    ]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    expect(result.symbols.find((symbol) => symbol.name === "mathUnknown")?.shape.evaluatedDefault).toBe(8);
    for (const name of ["mathSqrtNeg", "mathPowHuge", "mathPowBad", "mathSqrtBad"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    for (const name of ["mathBad", "mathOpen", "mathEmpty", "mathAbsBad", "mathString", "mathNoComma", "mathRoundBad", "mathRoundString"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    for (const name of ["castString", "mulMissing", "floatDivZero", "castEmpty"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
    expect(result.symbols.find((symbol) => symbol.name === "bitsAnd")?.shape.evaluatedDefault).toBe(2);
    expect(result.symbols.find((symbol) => symbol.name === "bitsOr")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "bitsXor")?.shape.evaluatedDefault).toBe(5);
    expect(result.symbols.find((symbol) => symbol.name === "shiftLeft")?.shape.evaluatedDefault).toBe(8);
    expect(result.symbols.find((symbol) => symbol.name === "shiftRight")?.shape.evaluatedDefault).toBe(-2);
    expect(result.symbols.find((symbol) => symbol.name === "shiftUnsigned")?.shape.evaluatedDefault).toBe(15);
    expect(result.symbols.find((symbol) => symbol.name === "bitPrec")?.shape.evaluatedDefault).toBe(24);
    expect(result.symbols.find((symbol) => symbol.name === "longShift")?.shape.evaluatedDefault).toBe(1099511627776);
    expect(result.symbols.find((symbol) => symbol.name === "longMask")?.shape.evaluatedDefault).toBe(4294967295);
    expect(result.symbols.find((symbol) => symbol.name === "longOr")?.shape.evaluatedDefault).toBe(4294967297);
    expect(result.symbols.find((symbol) => symbol.name === "longXor")?.shape.evaluatedDefault).toBe(4294967296);
    expect(result.symbols.find((symbol) => symbol.name === "longUnsigned")?.shape.evaluatedDefault).toBe(4294967295);
    expect(result.symbols.find((symbol) => symbol.name === "longAdd")?.shape.evaluatedDefault).toBe(4294967298);
    expect(result.symbols.find((symbol) => symbol.name === "longDiv")?.shape.evaluatedDefault).toBe(2147483648);
    expect(result.symbols.find((symbol) => symbol.name === "longMul")?.shape.evaluatedDefault).toBe(8589934592);
    expect(result.symbols.find((symbol) => symbol.name === "longSub")?.shape.evaluatedDefault).toBe(4294967294);
    expect(result.symbols.find((symbol) => symbol.name === "longRight")?.shape.evaluatedDefault).toBe(-2);
    expect(result.symbols.find((symbol) => symbol.name === "longHuge")?.shape.evaluatedDefault).toBe("4611686018427387905");
    expect(result.symbols.find((symbol) => symbol.name === "floatAdd")?.shape.evaluatedDefault).toBe(3);
    for (const name of ["bitFloat", "shiftFloat", "bitString", "comparison"]) {
      expect(result.symbols.find((symbol) => symbol.name === name)?.shape.evaluatedDefault).toBeUndefined();
    }
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
