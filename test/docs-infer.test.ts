import { describe, expect, it } from "vitest";
import type { Code } from "mdast";
import { buildGoTypeHints, buildPythonTypeHints } from "../src/docs/infer.js";
import { fenceAnchors } from "../src/docs/fences.js";
import type { Shape, Symbol } from "../src/types.js";

const shape: Shape = {
  kind: "function",
  params: [],
  returnType: undefined,
  visibility: "public",
  flags: [],
};

function symbol(name: string, over: Partial<Symbol> = {}): Symbol {
  return {
    id: over.id ?? `httpx|_models|function|${name}|0`,
    name,
    kind: "function",
    modulePath: "_models",
    packageName: "httpx",
    packageRoot: "/httpx",
    qualifiedName: `httpx.${name}`,
    aliases: [],
    shape,
    shapeText: JSON.stringify(shape),
    shapeHash: "h",
    paramNamesHash: "p",
    bodyHash: "b",
    contractFlags: [],
    line: 1,
    filePath: "httpx/_models.py",
    ...over,
  };
}

function model(): Symbol[] {
  const client = symbol("Client", { id: "client", kind: "class", qualifiedName: "httpx.Client" });
  const response = symbol("Response", { id: "response", kind: "class", qualifiedName: "httpx.Response" });
  const asyncClient = symbol("AsyncClient", { id: "async", kind: "class", qualifiedName: "httpx.AsyncClient" });
  const get = symbol("get", {
    id: "get",
    qualifiedName: "httpx.get",
    aliases: ["get", "httpx.get"],
    shape: { ...shape, returnType: "Response" },
  });
  const method = (name: string, parent: Symbol, returnType: string): Symbol =>
    symbol(name, {
      id: `${parent.id}.${name}`,
      kind: "method",
      parentId: parent.id,
      qualifiedName: `${parent.qualifiedName}.${name}`,
      aliases: [`${parent.name}.${name}`, `httpx.${parent.name}.${name}`],
      shape: { ...shape, kind: "method", returnType },
    });
  return [
    client,
    response,
    asyncClient,
    get,
    method("get", client, "Response"),
    method("send", asyncClient, "Response"),
    method("json", response, "typing.Any"),
    method("name", response, "str | None"),
    method("stream", client, "typing.Iterator[Response]"),
    method("open", client, "| None"),
  ];
}

function code(value: string): Code {
  return {
    type: "code",
    lang: "python",
    value,
    position: {
      start: { line: 10, column: 1, offset: 0 },
      end: { line: 40, column: 1, offset: value.length },
    },
  };
}

describe("Python type hints", () => {
  it("maps class methods and top-level functions to returned classes", () => {
    const hints = buildPythonTypeHints(model());
    expect(hints.returns.get("Client.get")).toBe("Response");
    expect(hints.returns.get("httpx.Client.get")).toBe("Response");
    expect(hints.returns.get("AsyncClient.send")).toBe("Response");
    expect(hints.returns.get("Client.stream")).toBe("Response");
    expect(hints.returns.get("get")).toBe("Response");
    expect(hints.returns.get("httpx.get")).toBe("Response");
    expect(hints.returns.get("Response.json")).toBeUndefined();
    expect(hints.returns.get("Response.name")).toBeUndefined();
    expect(hints.returns.get("Client.open")).toBeUndefined();
  });

  it("drops conflicting return types and keeps real classes only", () => {
    const client = symbol("Client", { id: "client", kind: "class", qualifiedName: "httpx.Client" });
    const first = symbol("get", {
      id: "one",
      kind: "method",
      parentId: client.id,
      qualifiedName: "httpx.Client.get",
      aliases: ["Client.get"],
      shape: { ...shape, returnType: "Response" },
    });
    const second = symbol("get", {
      id: "two",
      kind: "method",
      parentId: client.id,
      qualifiedName: "httpx.Client.get",
      aliases: ["Client.get"],
      shape: { ...shape, returnType: "Client" },
    });
    const response = symbol("Response", { id: "response", kind: "class", qualifiedName: "httpx.Response" });
    const empty = symbol("empty", { id: "empty", shape: { ...shape, returnType: "" } });
    const hints = buildPythonTypeHints([client, response, first, second, empty]);
    expect(hints.returns.has("Client.get")).toBe(false);
    expect(hints.returns.has("empty")).toBe(false);
  });
});

describe("Go fence inference", () => {
  it("infers local values from package constructor calls", () => {
    const viper = symbol("Viper", {
      id: "viper",
      kind: "class",
      packageName: "viper",
      qualifiedName: "viper.Viper",
      aliases: ["viper.Viper"],
    });
    const get = symbol("Get", {
      id: "get",
      kind: "method",
      parentId: viper.id,
      packageName: "viper",
      qualifiedName: "viper.Viper.Get",
      aliases: ["Viper.Get", "viper.Viper.Get"],
      shape: { ...shape, kind: "method", params: [], returnType: "any" },
    });
    const make = symbol("New", {
      id: "new",
      kind: "function",
      packageName: "viper",
      qualifiedName: "viper.New",
      aliases: ["New", "viper.New"],
      shape: { ...shape, returnType: "*Viper" },
    });
    const defaultVar = symbol("Default", {
      id: "default",
      kind: "const",
      packageName: "viper",
      qualifiedName: "viper.Default",
      aliases: ["viper.Default"],
      goValue: "New()",
      shape: { ...shape, kind: "const", typeShape: "expression" },
    });
    const emptyVar = symbol("Empty", {
      id: "empty",
      kind: "const",
      packageName: "viper",
      qualifiedName: "viper.Empty",
      aliases: ["viper.Empty"],
      goValue: "Viper{}",
      shape: { ...shape, kind: "const", typeShape: "expression" },
    });
    const hints = buildGoTypeHints([viper, get, make, defaultVar, emptyVar]);
    expect(hints.returns.get("viper.New")).toBe("Viper");
    expect(hints.values.get("viper.Default")).toBe("Viper");
    expect(hints.values.get("viper.Empty")).toBe("Viper");
    const result = fenceAnchors(
      {
        ...code([
          "v := viper.New()",
          "v.Get(\"key\")",
          "w := Viper{}",
          "w.Get(\"other\")",
          "var annotated *Viper",
          "annotated.Get(\"typed\")",
          "alias := annotated",
          "alias.Get(\"alias\")",
          "var copied = alias",
          "copied.Get(\"copied\")",
          "var changed *Viper",
          "changed = load()",
          "changed.Get(\"stale\")",
          "var assigned *Viper",
          "assigned = viper.New()",
          "assigned.Get(\"assigned\")",
          "var initialized *Viper = viper.New()",
          "initialized.Get(\"initialized\")",
          "var inferred = viper.New()",
          "inferred.Get(\"inferred\")",
          "defaulted := viper.Default",
          "defaulted.Get(\"default\")",
          "x := 1",
          "",
        ].join("\n")),
        lang: "go",
      } as unknown as Code,
      "docs/quickstart.md",
      "Quickstart",
      undefined,
      hints,
    );
    const tokens = result.anchors.map((anchor) => anchor.token);
    expect(tokens).toContain("viper.New");
    expect(tokens.filter((token) => token === "Viper.Get")).toHaveLength(9);
  });

  it("types function parameters from their signatures", () => {
    const result = fenceAnchors(
      { ...code("func f(v *Viper) {\n    v.Get(\"key\")\n}\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
    );
    expect(result.anchors.map((anchor) => anchor.token)).toContain("Viper.Get");
  });

  it("handles grouped and nested parameter types", () => {
    const result = fenceAnchors(
      { ...code("func grouped(v, w *Viper, lookup map[string]int) {\n    v.Get(\"a\")\n    w.Get(\"b\")\n}\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
    );
    const tokens = result.anchors.map((anchor) => anchor.token);
    expect(tokens.filter((token) => token === "Viper.Get")).toHaveLength(2);
  });

  it("types fence-local helper calls from their signatures", () => {
    const result = fenceAnchors(
      { ...code("func load() *Viper { return &Viper{} }\nfunc use() {\n    v := load()\n    v.Get(\"key\")\n}\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
    );
    expect(result.anchors.map((anchor) => anchor.token)).toContain("Viper.Get");
  });

  it("types multi-return helper assignments", () => {
    const result = fenceAnchors(
      { ...code("func load() (*Viper, error) { return New(), nil }\nfunc use() {\n    v, err := load()\n    if err != nil { return }\n    v.Get(\"key\")\n}\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
    );
    expect(result.anchors.map((anchor) => anchor.token)).toContain("Viper.Get");
  });

  it("resolves struct field chains", () => {
    const viper = symbol("Viper", {
      id: "viper", kind: "class", packageName: "viper",
      qualifiedName: "viper.Viper", aliases: ["viper.Viper"],
    });
    const config = symbol("Config", {
      id: "config", kind: "class", packageName: "viper",
      qualifiedName: "viper.Config", aliases: ["viper.Config"],
      shape: {
        kind: "class",
        members: [{
          name: "Viper",
          kind: "property",
          optional: false,
          shape: { kind: "property", typeShape: "*Viper" },
        }],
      },
    });
    const hints = buildGoTypeHints([viper, config]);
    expect(hints.fields.get("Config.Viper")).toBe("Viper");
    const result = fenceAnchors(
      { ...code("cfg := Config{Viper: viper.New()}\ncfg.Viper.Field(\"key\")\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
      undefined,
      hints,
    );
    expect(result.anchors.map((anchor) => anchor.token)).toContain("Viper.Field");
  });

  it("types qualified variables with explicit types", () => {
    const viper = symbol("Viper", {
      id: "viper", kind: "class", packageName: "viper",
      qualifiedName: "viper.Viper", aliases: ["viper.Viper"],
    });
    const selected = symbol("Selected", {
      id: "selected", kind: "const", packageName: "other",
      qualifiedName: "other.Selected", aliases: ["Selected", "other.Selected", "viper.Qualified"],
      shape: { kind: "const", typeShape: "*Viper" },
    });
    const hints = buildGoTypeHints([viper, selected]);
    expect(hints.values.get("viper.Qualified")).toBe("Viper");
    const result = fenceAnchors(
      { ...code("v := viper.Qualified\nv.Get(\"key\")\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
      undefined,
      hints,
    );
    expect(result.anchors.map((anchor) => anchor.token)).toContain("Viper.Get");
  });

  it("types asserted package values", () => {
    const viper = symbol("Viper", {
      id: "viper", kind: "class", packageName: "viper",
      qualifiedName: "viper.Viper", aliases: ["viper.Viper"],
    });
    const hints = buildGoTypeHints([viper]);
    const result = fenceAnchors(
      { ...code("v := viper.Default.(*Viper)\nv.Get(\"key\")\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
      undefined,
      hints,
    );
    expect(result.anchors.map((anchor) => anchor.token)).toContain("Viper.Get");
  });

  it("types anonymous function parameters", () => {
    const result = fenceAnchors(
      { ...code("func use() {\n    apply := func(v *Viper) {\n        v.Get(\"key\")\n    }\n    apply(New())\n}\n"), lang: "go" } as unknown as Code,
      "docs/api.md",
      "API",
    );
    expect(result.anchors.map((anchor) => anchor.token)).toContain("Viper.Get");
  });

  it("drops conflicting Go constructor return types", () => {
    const viper = symbol("Viper", {
      id: "viper", kind: "class", packageName: "viper",
      qualifiedName: "viper.Viper", aliases: ["viper.Viper"],
    });
    const client = symbol("Client", {
      id: "client", kind: "class", packageName: "viper",
      qualifiedName: "viper.Client", aliases: ["viper.Client"],
    });
    const first = symbol("New", {
      id: "new1", packageName: "viper", qualifiedName: "viper.New",
      aliases: ["viper.New"], shape: { ...shape, returnType: "*Viper" },
    });
    const second = symbol("New", {
      id: "new2", packageName: "viper", qualifiedName: "viper.New",
      aliases: ["viper.New"], shape: { ...shape, returnType: "*Client" },
    });
    expect(buildGoTypeHints([viper, client, first, second]).returns.get("viper.New")).toBeUndefined();
  });
});

describe("Python fence inference", () => {
  it("types assignments, annotations, with blocks and REPL prompts", () => {
    const hints = buildPythonTypeHints(model());
    const result = fenceAnchors(code(`
import httpx
client: Client = Client()
response = client.get("/")
response.json()
with AsyncClient() as async_client:
    async_client.send(request)
r = httpx.get("/")
r.json()
x = 1
x.json()
label: str = "x"
`), "docs/quickstart.md", "Quickstart", hints);
    const tokens = result.anchors.map((anchor) => anchor.token);
    expect(tokens).toEqual(expect.arrayContaining([
      "Client.get", "Response.json", "AsyncClient.send", "Response.json",
    ]));
    expect(tokens.filter((token) => token === "Response.json").length).toBeGreaterThanOrEqual(2);
    expect(tokens).not.toContain("Response.send");
  });

  it("infers from pycon assignments", () => {
    const hints = buildPythonTypeHints(model());
    const pycon = {
      ...code(">>> client = httpx.Client()\n>>> response = client.get('/')\n>>> response.json()\n"),
      lang: "pycon",
    } as unknown as Code;
    const tokens = fenceAnchors(pycon, "docs/quickstart.md", "Quickstart", hints).anchors.map((anchor) => anchor.token);
    expect(tokens).toEqual(expect.arrayContaining(["Client.get", "Response.json"]));
  });

  it("leaves untyped locals alone", () => {
    const hints = buildPythonTypeHints(model());
    const result = fenceAnchors(code("data = load()\ndata.json()\n"), "docs/api.md", "API", hints);
    expect(result.anchors.map((anchor) => anchor.token)).not.toContain("Response.json");
  });

  it("ignores with blocks that do not construct a known class", () => {
    const hints = buildPythonTypeHints(model());
    const result = fenceAnchors(code("with open('x') as handle:\n    handle.read()\n"), "docs/api.md", "API", hints);
    expect(result.anchors.map((anchor) => anchor.token)).not.toContain("Response.read");
  });

  it("falls back to line one when a fence has no position", () => {
    const anonymous = { type: "code", lang: "python", value: "client = httpx.Client()\n" } as unknown as Code;
    const result = fenceAnchors(anonymous, "docs/api.md", "API");
    expect(result.anchors[0]?.line).toBe(2);
  });
});
