import { describe, expect, it } from "vitest";
import {
  buildIndex,
  isApiDoc,
  moduleMatches,
  normalizeModuleSource,
  parseToken,
  scoreCandidates,
  vetoReason,
} from "../src/resolve/score.js";
import { resolveAnchor } from "../src/resolve/resolve.js";
import type { DocAnchor, Shape, Symbol } from "../src/types.js";

const shape: Shape = {
  kind: "function",
  params: [
    { name: "id", type: "string", optional: false, rest: false, hasDefault: false },
    { name: "opts", type: "object", optional: true, rest: false, hasDefault: false },
  ],
  returnType: "User",
};

function symbol(name: string, over: Partial<Symbol> = {}): Symbol {
  return {
    id: over.id ?? `app|src/users|function|${name}|0`,
    name,
    kind: "function",
    modulePath: "src/users",
    packageName: "app",
    packageRoot: "/app",
    qualifiedName: `app.src.users.${name}`,
    aliases: [],
    shape,
    shapeText: JSON.stringify(shape),
    shapeHash: "h",
    paramNamesHash: "p",
    bodyHash: "b",
    contractFlags: [],
    line: 1,
    filePath: "src/users.ts",
    ...over,
  };
}

function anchor(token: string, over: Partial<DocAnchor> = {}): DocAnchor {
  return {
    docPath: "README.md",
    line: 1,
    column: 1,
    length: token.length,
    token,
    occurrence: 0,
    surface: "inlineCode",
    contextFp: "ctx",
    importTable: {},
    localDecls: [],
    fragment: false,
    ...over,
  };
}

describe("token parsing", () => {
  it("extracts calls, arity and generic forms", () => {
    expect(parseToken("getUser(id, opts)")).toEqual({ base: "getUser", call: true, arity: 2 });
    expect(parseToken("getUser()")).toEqual({ base: "getUser", call: true, arity: 0 });
    expect(parseToken("getUser<T>(id)")).toEqual({ base: "getUser", call: true, arity: 1 });
    expect(parseToken("new Client()")).toEqual({ base: "Client", call: true, arity: 0 });
    expect(parseToken("Client.request")).toEqual({ base: "Client.request", call: false, arity: 0 });
    expect(parseToken("anyhow!")).toEqual({ base: "anyhow", call: true, arity: 0 });
    expect(parseToken("bail!(error)")).toEqual({ base: "bail", call: true, arity: 1 });
    expect(parseToken("anyhow::Result<T>")).toEqual({ base: "anyhow::Result", call: false, arity: 0 });
    expect(parseToken("Result<T, E>")).toEqual({ base: "Result", call: false, arity: 0 });
    expect(parseToken("getUser(map<A, B>)")).toEqual({ base: "getUser", call: true, arity: 1 });
    expect(parseToken("plain")).toEqual({ base: "plain", call: false, arity: 0 });
  });
});

describe("vetoes", () => {
  const cases: Array<[string, string]> = [
    ["https://example.com", "url"],
    ["git@example.com", "url"],
    ["user@example.com", "email"],
    ["1.2.3", "semver"],
    ["2026-11-03", "date"],
    ["10ms", "duration"],
    ["#fff", "hex color"],
    ["123e4567-e89b-12d3-a456-426614174000", "uuid"],
    ["application/json", "mime"],
    ["--no-verify", "cli flag"],
    ["./src/config", "path"],
    ["src/**", "glob or regex"],
    ["function", "keyword"],
    ["foo bar", "whitespace"],
    ["GET /users", "http"],
  ];

  for (const [token, reason] of cases) {
    it(`vetoes ${token}`, () => {
      expect(vetoReason(token, anchor(token))).toBe(reason);
    });
  }

  it("vetoes prose words in README but not API docs", () => {
    expect(vetoReason("install", anchor("install"))).toBe("prose word");
    expect(vetoReason("install", anchor("install", { docPath: "docs/api.md" }))).toBeUndefined();
    expect(vetoReason("install", anchor("install", {
      importTable: { install: { source: "./mod", imported: "install" } },
    }))).toBeUndefined();
  });

  it("handles missing imported names, mismatched paths and property params", () => {
    const index = buildIndex([symbol("getUser")]);
    expect(scoreCandidates(anchor("getUser", {
      importTable: { getUser: { source: "./users", imported: "missing" } },
    }), index).reason).toBe("unbound");
    expect(scoreCandidates(anchor("api.missing", {
      importTable: { api: { source: "./users", imported: "*" } },
    }), index).reason).toBe("unbound");
    expect(scoreCandidates(anchor("Foo.missing"), index).reason).toBe("unbound");
    const property = buildIndex([symbol("VERSION", {
      kind: "property",
      shape: { kind: "property", typeShape: "string" },
      id: "prop",
    })]);
    expect(scoreCandidates(anchor("VERSION", { docPath: "docs/api.md" }), property).reason).toBe("unbound");
  });

  it("covers remaining veto edges", () => {
    expect(vetoReason("", anchor(""))).toBe("empty");
    expect(vetoReason("text/plain::x", anchor("text/plain::x"))).toBeUndefined();
    expect(vetoReason("src/*<T>", anchor("src/*<T>"))).toBeUndefined();
  });

  it("allows ordinary identifiers", () => {
    expect(vetoReason("getUser", anchor("getUser"))).toBeUndefined();
    expect(vetoReason("FOO_BAR", anchor("FOO_BAR"))).toBeUndefined();
    expect(vetoReason("Response.json()", anchor("Response.json()"))).toBeUndefined();
    expect(vetoReason("Client.get", anchor("Client.get"))).toBeUndefined();
    expect(vetoReason("data.json()", anchor("data.json()"))).toBeUndefined();
    expect(vetoReason("README.md", anchor("README.md"))).toBe("path");
  });

  it("recognizes API docs", () => {
    expect(isApiDoc("docs/api.md")).toBe(true);
    expect(isApiDoc("docs/reference/users.md")).toBe(true);
    expect(isApiDoc("docs/guide.md")).toBe(true);
    expect(isApiDoc("README.md")).toBe(false);
  });
});

describe("module matching", () => {
  it("normalizes relative sources", () => {
    expect(normalizeModuleSource("./users.ts")).toBe("users");
    expect(normalizeModuleSource("../pkg/index.ts")).toBe("pkg");
    expect(normalizeModuleSource("@scope/pkg")).toBe("pkg");
    expect(normalizeModuleSource("./users.d.ts")).toBe("users");
  });

  it("matches packages and modules", () => {
    expect(moduleMatches(symbol("getUser"), "./users")).toBe(true);
    expect(moduleMatches(symbol("getUser"), "users")).toBe(true);
    expect(moduleMatches(symbol("getUser"), "app")).toBe(true);
    expect(moduleMatches(symbol("getUser"), "other")).toBe(false);
    expect(moduleMatches(symbol("getUser", { packageName: "hono" }), "hono")).toBe(true);
    expect(moduleMatches(symbol("getUser"), "")).toBe(false);
  });
});

describe("indexing and scoring", () => {
  it("indexes names, aliases and qualified forms", () => {
    const index = buildIndex([symbol("getUser", { aliases: ["fetchUser", "users.fetchUser"] })]);
    expect(index.byName.get("getUser")).toHaveLength(1);
    expect(index.byName.get("fetchUser")).toHaveLength(1);
    expect(index.byQualified.get("users.fetchUser")).toHaveLength(1);
    const scoped = buildIndex([symbol("getUser", { aliases: ["users::fetchUser"] })]);
    expect(scoped.byQualified.get("users::fetchUser")).toHaveLength(1);
    expect(scoped.byQualified.get("users.fetchUser")).toHaveLength(1);
  });

  it("binds a unique call in an API doc", () => {
    const index = buildIndex([symbol("getUser")]);
    const result = scoreCandidates(anchor("getUser(id)", { docPath: "docs/api.md" }), index);
    expect(result.reason).toBe("bound");
    expect(result.binding?.symbol.name).toBe("getUser");
    expect(result.binding?.score).toBeGreaterThanOrEqual(0.7);
  });

  it("stays silent for a bare generic name in prose", () => {
    const index = buildIndex([symbol("getUser")]);
    expect(scoreCandidates(anchor("getUser"), index).reason).toBe("unbound");
  });

  it("binds through fence imports", () => {
    const index = buildIndex([symbol("getUser")]);
    const result = scoreCandidates(anchor("getUser", {
      importTable: { getUser: { source: "./users", imported: "getUser" } },
    }), index);
    expect(result.reason).toBe("bound");
    expect(result.binding?.evidence).toContain("fence import");
  });

  it("binds qualified names", () => {
    const index = buildIndex([symbol("getUser", { aliases: ["users.getUser"] })]);
    const result = scoreCandidates(anchor("users.getUser"), index);
    expect(result.reason).toBe("bound");
  });

  it("binds class-qualified method names that look like file extensions", () => {
    const index = buildIndex([
      symbol("json", {
        kind: "method",
        qualifiedName: "httpx._models.Response.json",
        aliases: ["Response.json", "httpx.Response.json"],
        shape: { kind: "method", async: false, params: [], returnType: "Any" },
      }),
    ]);
    const result = scoreCandidates(anchor("Response.json()"), index);
    expect(result.reason).toBe("bound");
    expect(result.binding?.symbol.name).toBe("json");
    const packageQualified = scoreCandidates(anchor("httpx.Response.json()"), index);
    expect(packageQualified.reason).toBe("bound");
  });

  it("binds qualified suffixes", () => {
    const index = buildIndex([symbol("getUser", { aliases: [] })]);
    const result = scoreCandidates(anchor("users.getUser(id)"), index);
    expect(result.reason).toBe("bound");
    expect(result.binding?.evidence).toContain("qualified suffix");
  });

  it("binds macro invocations and bare type aliases", () => {
    const index = buildIndex([
      symbol("anyhow", { aliases: ["anyhow!"] }),
      symbol("Result", { kind: "type", qualifiedName: "app.Result" }),
    ]);
    expect(scoreCandidates(anchor("anyhow!"), index).reason).toBe("bound");
    expect(scoreCandidates(anchor("bail!(error)"), index).reason).toBe("unbound");
    const alias = scoreCandidates(anchor("Result"), index);
    expect(alias.reason).toBe("bound");
    expect(alias.binding?.evidence).toContain("type alias");
  });

  it("binds namespace-qualified imports", () => {
    const index = buildIndex([symbol("getUser")]);
    const result = scoreCandidates(anchor("api.getUser", {
      importTable: { api: { source: "./users", imported: "*" } },
    }), index);
    expect(result.reason).toBe("bound");
  });

  it("ignores mismatched imports and member namespaces", () => {
    const index = buildIndex([symbol("getUser")]);
    const mismatch = scoreCandidates(anchor("getUser", {
      importTable: { getUser: { source: "./other", imported: "getUser" } },
    }), index);
    expect(mismatch.reason).toBe("unbound");
    const child = symbol("request", { parentId: "p", id: "child" });
    const memberIndex = buildIndex([child]);
    const namespace = scoreCandidates(anchor("api", {
      importTable: { api: { source: "./users", imported: "*" } },
    }), memberIndex);
    expect(namespace.reason).toBe("unbound");
  });

  it("keeps a bare namespace unbound", () => {
    const index = buildIndex([symbol("getUser")]);
    const result = scoreCandidates(anchor("api", {
      importTable: { api: { source: "./users", imported: "*" } },
    }), index);
    expect(result.reason).toBe("unbound");
  });

  it("treats explicit references and signature fences as strong claims", () => {
    const index = buildIndex([symbol("getUser")]);
    const explicit = scoreCandidates(anchor("getUser", { surface: "explicitRef" }), index);
    expect(explicit.reason).toBe("bound");
    expect(explicit.binding?.evidence).toContain("explicit reference");
    const signature = scoreCandidates(anchor("getUser", { surface: "signatureFence" }), index);
    expect(signature.reason).toBe("bound");
    expect(signature.binding?.evidence).toContain("signature fence");
  });

  it("honors shadowing", () => {
    const index = buildIndex([symbol("getUser")]);
    const result = scoreCandidates(anchor("getUser(id)", {
      docPath: "docs/api.md",
      localDecls: ["getUser"],
    }), index);
    expect(result.reason).toBe("unbound");
  });

  it("penalizes fragments and short tokens", () => {
    const index = buildIndex([symbol("getUser"), symbol("x")]);
    expect(scoreCandidates(anchor("getUser", { fragment: true }), index).reason).toBe("unbound");
    expect(scoreCandidates(anchor("x"), index).reason).toBe("unbound");
  });

  it("penalizes ambiguous candidates", () => {
    const index = buildIndex([
      symbol("getUser"),
      symbol("getUser", { id: "app|src/other|function|getUser|0", packageName: "other" }),
    ]);
    const result = scoreCandidates(anchor("getUser(id)", {
      docPath: "docs/api.md",
      surface: "inlineCode",
    }), index, { repeated: true });
    expect(result.reason).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
  });

  it("reports vetoes and empty candidate sets", () => {
    const index = buildIndex([symbol("getUser")]);
    expect(scoreCandidates(anchor("https://x.test"), index)).toMatchObject({ reason: "vetoed" });
    expect(scoreCandidates(anchor("missing"), index)).toMatchObject({ reason: "unbound" });
  });

  it("wraps resolution", () => {
    const index = buildIndex([symbol("getUser")]);
    expect(resolveAnchor(anchor("getUser(id)", { docPath: "docs/api.md" }), index).reason).toBe("bound");
  });
});
