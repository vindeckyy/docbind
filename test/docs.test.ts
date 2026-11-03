import { describe, expect, it } from "vitest";
import { parseDoc, parseDocs } from "../src/docs/parse.js";
import { assignOccurrences, anchorKey } from "../src/docs/anchors.js";
import { contextFingerprint, hasNegativeCue } from "../src/docs/context.js";
import { isHistoricalContext, isSupportedFence } from "../src/docs/fences.js";
import { tempProject } from "./helpers.js";

describe("context", () => {
  it("fingerprints local prose with a placeholder", () => {
    const first = contextFingerprint(["Call getUser now"], "getUser");
    const second = contextFingerprint(["Call getUser now"], "getUser");
    const changed = contextFingerprint(["Call get_user now"], "getUser");
    expect(first).toBe(second);
    expect(first).not.toBe(changed);
    expect(first).toHaveLength(16);
  });

  it("detects historical cues", () => {
    expect(hasNegativeCue("getUser was removed in v2")).toBe(true);
    expect(hasNegativeCue("Call getUser")).toBe(false);
    expect(isHistoricalContext("Migration", "getUser")).toBe(true);
    expect(isHistoricalContext("API", "getUser")).toBe(false);
  });
});

describe("anchors", () => {
  it("assigns occurrence indexes and dedupes identical positions", () => {
    const base = {
      docPath: "a.md",
      line: 1,
      column: 1,
      length: 3,
      token: "foo",
      surface: "inlineCode" as const,
      contextFp: "ctx",
      importTable: {},
      localDecls: [],
      fragment: false,
    };
    const anchors = assignOccurrences([
      { ...base, occurrence: 0 },
      { ...base, occurrence: 0 },
      { ...base, line: 2, occurrence: 0 },
    ]);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].occurrence).toBe(0);
    expect(anchors[1].occurrence).toBe(1);
    expect(anchorKey(anchors[0])).toContain("a.md");
  });
});

describe("markdown parsing", () => {
  it("extracts inline code with a content column", () => {
    const text = "# API\n\nCall `getUser(id)` now.\n";
    const result = parseDoc("docs/api.md", text);
    expect(result.parseFailures).toBe(0);
    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0]).toMatchObject({
      token: "getUser(id)",
      line: 3,
      column: 7,
      length: 11,
      surface: "inlineCode",
    });
  });

  it("marks heading and table code", () => {
    const text = "## `getUser()`\n\n| Name | Notes |\n|---|---|\n| `getUser` | x |\n";
    const result = parseDoc("docs/api.md", text);
    expect(result.anchors.map((anchor) => anchor.surface)).toEqual(["headingCode", "tableCode"]);
  });

  it("parses ts fences and imports", () => {
    const text = "```ts\nimport { getUser } from \"./users\";\nconst user = getUser(id);\n```\n";
    const result = parseDoc("docs/api.md", text);
    const tokens = result.anchors.map((anchor) => anchor.token);
    expect(tokens).toContain("getUser");
    expect(tokens).not.toContain("user");
    expect(result.anchors[0].surface).toBe("fenceToken");
    expect(result.anchors[0].importTable.getUser).toEqual({ source: "./users", imported: "getUser" });
  });

  it("parses python fences", () => {
    const text = "```python\nfrom users import get_user as fetch_user\nresult = fetch_user(1)\n```\n";
    const result = parseDoc("docs/api.md", text);
    expect(result.anchors.map((anchor) => anchor.token)).toContain("fetch_user");
    expect(result.anchors[0].importTable.fetch_user).toEqual({ source: "users", imported: "get_user" });
  });

  it("detects signature fences", () => {
    const text = "```ts\nfunction getUser(id: string): User\n```\n";
    const result = parseDoc("docs/api.md", text);
    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0]).toMatchObject({ token: "getUser", surface: "signatureFence" });
    expect(result.anchors[0].signatureShape?.kind).toBe("function");
  });

  it("detects rust and go signature fences", () => {
    const rust = parseDoc("docs/api.md", "```rust\nfn get_user(id: &str) -> Option<User>\n```\n");
    expect(rust.anchors[0]).toMatchObject({ token: "get_user", surface: "signatureFence" });
    expect(rust.anchors[0].signatureShape?.kind).toBe("function");
    const go = parseDoc("docs/api.md", "```go\nfunc GetUser(id string) string\n```\n");
    expect(go.anchors[0]).toMatchObject({ token: "GetUser", surface: "signatureFence" });
    expect(go.anchors[0].signatureShape?.kind).toBe("function");
    const goMethod = parseDoc("docs/api.md", "```go\nfunc (u *User) Rename(name string) error\n```\n");
    expect(goMethod.anchors[0].signatureShape?.kind).toBe("method");
    const rustMethod = parseDoc("docs/api.md", "```rust\nfn rename(&mut self, name: String)\n```\n");
    expect(rustMethod.anchors[0].signatureShape?.kind).toBe("method");
    const indented = parseDoc("docs/api.md", "```rust\n  fn find(\n    id: &str\n  ) -> Option<User>\n```\n");
    expect(indented.anchors[0]).toMatchObject({ token: "find", surface: "signatureFence" });
    expect(indented.anchors[0].line).toBe(2);
  });

  it("marks fragment fences", () => {
    const text = "```ts\nconst x = getUser(/* ... */ id);\n```\n";
    const result = parseDoc("docs/api.md", text);
    expect(result.anchors[0]?.fragment).toBe(true);
  });

  it("extracts explicit references and skips code ranges", () => {
    const text = "See {@link getUser} and :func:`getUser`.\n\n```ts\n{@link inside}\n```\n";
    const result = parseDoc("docs/api.md", text);
    expect(result.anchors.filter((anchor) => anchor.surface === "explicitRef")).toHaveLength(2);
    expect(result.anchors.filter((anchor) => anchor.surface === "explicitRef").map((anchor) => anchor.token)).not.toContain("inside");
  });

  it("drops historical mentions", () => {
    expect(parseDoc("docs/api.md", "`getUser` was removed in v2.\n").anchors).toHaveLength(0);
    expect(parseDoc("docs/api.md", "`getUser` is deprecated.\n").anchors).toHaveLength(0);
  });

  it("skips unlabeled fences and multiline inline code", () => {
    expect(parseDoc("docs/api.md", "```\ngetUser\n```\n").anchors).toHaveLength(0);
    expect(parseDoc("docs/api.md", "`get\nUser`\n").anchors).toHaveLength(0);
  });

  it("deduplicates identical anchors", () => {
    const text = "Call `getUser` and `getUser`.\n";
    const result = parseDoc("docs/api.md", text);
    expect(result.anchors).toHaveLength(2);
    expect(result.anchors.map((anchor) => anchor.occurrence)).toEqual([0, 1]);
  });

  it("reads docs and counts missing files", () => {
    const root = tempProject({ "docs/a.md": "`getUser`\n" });
    const result = parseDocs(root, ["docs/a.md", "docs/missing.md"]);
    expect(result.docsScanned).toBe(1);
    expect(result.anchors).toHaveLength(1);
    expect(result.parseFailures).toBe(1);
  });

  it("handles blockquotes, double backticks and seealso", () => {
    const blockquote = parseDoc("docs/api.md", "> Call `getUser`.\n");
    expect(blockquote.anchors).toHaveLength(1);
    const double = parseDoc("docs/api.md", "`` `getUser` ``\n");
    expect(double.anchors[0]).toMatchObject({ column: 3, token: "`getUser`" });
    const see = parseDoc("docs/api.md", "seealso `getUser`\n");
    expect(see.anchors.find((anchor) => anchor.surface === "explicitRef")?.token).toBe("getUser");
  });

  it("ignores literal explicit-reference syntax in code spans", () => {
    const literal = parseDoc("docs/api.md", "Write `{@link foo}` to link.\n");
    expect(literal.anchors.filter((anchor) => anchor.surface === "explicitRef")).toHaveLength(0);
    const real = parseDoc("docs/api.md", "Write {@link foo} to link.\n");
    expect(real.anchors.filter((anchor) => anchor.surface === "explicitRef")).toHaveLength(1);
  });

  it("ignores invalid explicit references", () => {
    const result = parseDoc("docs/api.md", "{@link } and :func:`a b`\n");
    expect(result.anchors.filter((anchor) => anchor.surface === "explicitRef")).toHaveLength(0);
  });

  it("knows supported fences", () => {
    expect(isSupportedFence("ts")).toBe(true);
    expect(isSupportedFence("PYTHON")).toBe(true);
    expect(isSupportedFence("text")).toBe(false);
    expect(isSupportedFence(null)).toBe(false);
  });
});
