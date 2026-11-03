import { describe, expect, it } from "vitest";
import type { Code } from "mdast";
import { buildPythonTypeHints } from "../src/docs/infer.js";
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
