import { describe, expect, it } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkProject, markLockAdvanced } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { writeLock } from "../src/lock/write.js";
import { entryFromBinding, readLock } from "../src/lock/schema.js";
import { parseDoc } from "../src/docs/parse.js";
import { extractSurface } from "../src/surface/index.js";
import { discoverCode } from "../src/discover.js";
import { applyFixes } from "../src/fix.js";
import { tempProject } from "./helpers.js";

const config = parseConfig({});

function files(code: string, doc: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "package.json": JSON.stringify({ name: "app" }),
    "src/users.ts": code,
    "docs/api.md": doc,
    ...extra,
  };
}

function lockNow(root: string, activeConfig = config): void {
  const result = checkProject(root, activeConfig);
  writeLock(root, markLockAdvanced({ ...result.lock, engine: "0.1.0" }));
}

const userCode = (name = "getUser", extraParam = ""): string => `
export interface User { id: string; email?: string }
export function ${name}(id: string${extraParam}): User { return { id }; }
export class Client { request(path: string): Promise<User> { return Promise.resolve({ id: path }); } }
`;

describe("check pipeline", () => {
  it("binds a clean repo and reports nothing", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)` and `users.getUser(id)`.\n"));
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.stats.anchors).toBe(2);
    expect(result.stats.bound).toBe(2);
    expect(result.stats.unbound).toBe(0);
    expect(result.pending).toHaveLength(2);
    lockNow(root);
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("detects a rename, fixes it, and then runs clean", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode("get_user"));
    const result = checkProject(root, config);
    expect(result.findings.map((finding) => finding.rule)).toEqual(["L4-renamed"]);
    expect(result.findings[0].fix).toMatchObject({ from: "getUser", to: "get_user" });
    const fixed = applyFixes(root, result.findings);
    expect(fixed.changedFiles).toEqual(["docs/api.md"]);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toContain("`get_user(id)`");
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("reports a removal through a tombstone", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), "export const other = 1;\n");
    const first = checkProject(root, config);
    expect(first.findings.map((finding) => finding.rule)).toEqual(["L1-broken"]);
    writeLock(root, markLockAdvanced({ ...first.lock, engine: "0.1.0" }));
    expect(first.lock.tombstones).toHaveLength(1);
    const second = checkProject(root, config);
    expect(second.findings.map((finding) => finding.rule)).toEqual(["L1-broken"]);
  });

  it("stays silent for additive changes and keeps the baseline", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode("getUser", ", opts?: { cache: boolean }"));
    expect(checkProject(root, config).findings).toEqual([]);
    writeFileSync(join(root, "src/users.ts"), userCode("getUser"));
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("reports a required parameter as reshaped", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode("getUser", ", force: boolean"));
    const result = checkProject(root, config);
    expect(result.findings[0]?.rule).toBe("L3-reshaped");
    expect(result.findings[0]?.message).toContain("required parameter");
  });

  it("reports a qualified path move", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `users.getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), "");
    writeFileSync(join(root, "src/accounts.ts"), userCode());
    const result = checkProject(root, config);
    expect(result.findings.map((finding) => finding.rule)).toEqual(["L2-moved"]);
    expect(result.findings[0].fix?.kind).toBe("replacePath");
  });

  it("checks signature fences against real symbols", () => {
    const root = tempProject(files(userCode(), "```ts\nfunction getUser(id: string): User\n```\n"));
    const good = checkProject(root, config);
    expect(good.findings).toEqual([]);
    expect(good.pending).toHaveLength(1);
    expect(good.pending[0].anchor.surface).toBe("signatureFence");
    writeFileSync(join(root, "src/users.ts"), userCode().replace(": User {", ": { id: string } {"));
    const bad = checkProject(root, config);
    expect(bad.findings.map((finding) => finding.rule)).toEqual(["L3-reshaped"]);
  });

  it("reports an unresolved explicit reference", () => {
    const root = tempProject(files(userCode(), "See {@link missing}.\n"));
    const result = checkProject(root, config);
    expect(result.findings.map((finding) => finding.rule)).toEqual(["L1-broken"]);
  });

  it("flags new deprecation when enabled", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode().replace(
      "export function getUser",
      "/** @deprecated use fetchUser */\nexport function getUser",
    ));
    const enabled = parseConfig({ severity: { "S1-deprecated": "warning" } });
    expect(checkProject(root, enabled).findings.map((finding) => finding.rule)).toEqual(["S1-deprecated"]);
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("clears when the doc is edited", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode("get_user"));
    expect(checkProject(root, config).findings).toHaveLength(1);
    writeFileSync(join(root, "docs/api.md"), "# API\n\nCall `get_user(id)`.\n");
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("does not bind prose words in a README", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/install.ts": "export function install(): void {}",
      "README.md": "Run `install` to set up.\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.stats.bound).toBe(0);
  });

  it("ignores generated docs", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": userCode(),
      "docs/generated.md": "<!-- generated -->\n`getUser(id)`\n",
    });
    const result = checkProject(root, parseConfig({ docs: ["docs/**/*.md"] }));
    expect(result.stats.docsScanned).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("can refresh without a baseline", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode("get_user"));
    writeFileSync(join(root, "docs/api.md"), "# API\n\nCall `get_user(id)`.\n");
    const result = checkProject(root, config, { ignoreBaseline: true });
    expect(result.findings).toEqual([]);
    expect(result.pending[0].symbol.name).toBe("get_user");
  });

  it("drops claims when the doc disappears", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    rmSync(join(root, "docs/api.md"));
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.lock.anchors).toEqual([]);
  });

  it("deduplicates lock entries", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    const current = readLock(root);
    writeLock(root, { ...current, anchors: [...current.anchors, current.anchors[0]] });
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("keeps tombstones through a move", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `users.getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), "");
    writeFileSync(join(root, "src/accounts.ts"), userCode());
    const first = checkProject(root, config);
    expect(first.findings[0].rule).toBe("L2-moved");
    writeLock(root, markLockAdvanced({ ...first.lock, engine: "0.1.0" }));
    const second = checkProject(root, config);
    expect(second.findings[0].rule).toBe("L2-moved");
  });

  it("reports a tombstone whose target is gone", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "docs/api.md": "Call `getUser`.\n",
    });
    writeLock(root, {
      schema: 1,
      engine: "0.1.0",
      generation: 1,
      anchors: [],
      tombstones: [{
        symbolId: "old",
        name: "getUser",
        qualifiedName: "app.users.getUser",
        kind: "function",
        shapeHash: "h",
        shape: '{"kind":"function"}',
        bodyHash: "b",
        removedInGeneration: 1,
        renamedTo: "missing",
      }],
    });
    expect(checkProject(root, config).findings[0]?.rule).toBe("L1-broken");
  });

  it("respects severity off", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode("get_user"));
    const off = parseConfig({
      severity: {
        "L1-broken": "off",
        "L2-moved": "off",
        "L3-reshaped": "off",
        "L4-renamed": "off",
        "S1-deprecated": "off",
      },
    });
    expect(checkProject(root, off).findings).toEqual([]);
  });

  it("does not repeat an existing deprecation", () => {
    const root = tempProject(files(
      userCode().replace("export function getUser", "/** @deprecated */\nexport function getUser"),
      "# API\n\nCall `getUser(id)`.\n",
    ));
    lockNow(root);
    const enabled = parseConfig({ severity: { "S1-deprecated": "warning" } });
    expect(checkProject(root, enabled).findings).toEqual([]);
  });

  it("binds a valid explicit reference", () => {
    const root = tempProject(files(userCode(), "See {@link getUser}.\n"));
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending).toHaveLength(1);
  });

  it("sorts findings by doc path", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    writeFileSync(join(root, "docs/z.md"), "Call `getUser(id)`.\n");
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode("get_user"));
    const result = checkProject(root, config);
    expect(result.findings.map((finding) => finding.doc.path)).toEqual(["docs/api.md", "docs/z.md"]);
  });

  it("handles const shape changes", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": 'export const VERSION: string = "1";\n',
      "docs/api.md": "Value `users.VERSION`.\n",
    });
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), "export const VERSION: number = 1;\n");
    const result = checkProject(root, config);
    expect(result.findings[0]?.rule).toBe("L3-reshaped");
    expect(result.findings[0]?.message).toContain("value type changed");
  });

  it("reports a bare-name move as broken", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), "");
    writeFileSync(join(root, "src/accounts.ts"), userCode());
    expect(checkProject(root, config).findings[0]?.rule).toBe("L1-broken");
  });

  it("reports a moved path when the symbol is unchanged", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `users.getUser(id)`.\n"));
    writeFileSync(join(root, "src/users.ts"), "");
    writeFileSync(join(root, "src/accounts.ts"), userCode());
    const anchor = parseDoc("docs/api.md", "# API\n\nCall `users.getUser(id)`.\n").anchors[0];
    const symbol = extractSurface(root, discoverCode(root, config), config).symbols
      .find((candidate) => candidate.name === "getUser")!;
    writeLock(root, {
      schema: 1,
      engine: "0.1.0",
      generation: 1,
      anchors: [entryFromBinding({ anchor, symbol, score: 0.9, evidence: [] })],
      tombstones: [],
    });
    expect(checkProject(root, config).findings[0]?.rule).toBe("L2-moved");
  });

  it("checks locked signature fences", () => {
    const root = tempProject(files(userCode(), "```ts\nfunction getUser(id: string): User\n```\n"));
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), userCode().replace(": User {", ": { id: string } {"));
    expect(checkProject(root, config).findings[0]?.rule).toBe("L3-reshaped");
  });

  it("reports a tombstone rename to a different name", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export function fetchUser(): void {}\n",
      "docs/api.md": "Call `getUser`.\n",
    });
    writeLock(root, {
      schema: 1,
      engine: "0.1.0",
      generation: 1,
      anchors: [],
      tombstones: [{
        symbolId: "old",
        name: "getUser",
        qualifiedName: "app.users.getUser",
        kind: "function",
        shapeHash: "h",
        shape: '{"kind":"function"}',
        bodyHash: "b",
        removedInGeneration: 1,
        renamedTo: "app|src/users|function|fetchUser|0",
      }],
    });
    const result = checkProject(root, config);
    expect(result.findings[0]?.rule).toBe("L4-renamed");
    expect(result.findings[0]?.fix?.to).toBe("fetchUser");
  });

  it("suppresses explicit and tombstone findings when off", () => {
    const off = parseConfig({
      severity: {
        "L1-broken": "off",
        "L2-moved": "off",
        "L3-reshaped": "off",
        "L4-renamed": "off",
        "S1-deprecated": "off",
      },
    });
    const explicit = tempProject(files(userCode(), "See {@link missing}.\n"));
    expect(checkProject(explicit, off).findings).toEqual([]);
    const tombstone = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "docs/api.md": "Call `getUser`.\n",
    });
    writeLock(tombstone, {
      schema: 1,
      engine: "0.1.0",
      generation: 1,
      anchors: [],
      tombstones: [{
        symbolId: "old",
        name: "getUser",
        qualifiedName: "app.users.getUser",
        kind: "function",
        shapeHash: "h",
        shape: '{"kind":"function"}',
        bodyHash: "b",
        removedInGeneration: 1,
        renamedTo: "missing",
      }],
    });
    expect(checkProject(tombstone, off).findings).toEqual([]);
  });

  it("does not report JS and .d.ts shape disagreement", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/greet.js": "export function greet(name) { return name; }\n",
      "src/greet.d.ts": "export function greet(name: string): string;\n",
      "docs/api.md": "Call `greet(name)`.\n",
    });
    lockNow(root);
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("binds qualified package chains in Go docs", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "pkg/viper.go": "package viper\nfunc SetConfigName(name string) {}\n",
      "docs/api.md": "Call `viper.SetConfigName(name)`.\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    const result = checkProject(root, goConfig);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.name).toBe("SetConfigName");
  });

  it("binds TypeScript namespace re-exports", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export function getUser(id: string): { id: string } { return { id }; }\n",
      "src/api.ts": 'export * as app from "./users";\n',
      "docs/api.md": "Call `app.getUser(id)`.\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.name).toBe("getUser");
    lockNow(root);
    writeFileSync(join(root, "src/users.ts"), "export function get_user(id: string): { id: string } { return { id }; }\n");
    expect(checkProject(root, config).findings[0]?.rule).toBe("L4-renamed");
  });

  it("checks Rust signature fences", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "rsapp"\n',
      "src/lib.rs": "pub struct User;\npub fn get_user(id: &str) -> Option<User> { None }\n",
      "docs/api.md": "```rust\nfn get_user(id: &str) -> Option<User>\n```\n",
    });
    expect(checkProject(root, config).findings).toEqual([]);
    writeFileSync(join(root, "src/lib.rs"), "pub struct User;\npub fn get_user(id: &str) -> User { User }\n");
    expect(checkProject(root, config).findings[0]?.rule).toBe("L3-reshaped");
  });

  it("checks Go signature fences", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "pkg/users.go": "package users\nfunc GetUser(id string) string { return id }\n",
      "docs/api.md": "```go\nfunc GetUser(id string) string\n```\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    expect(checkProject(root, goConfig).findings).toEqual([]);
    writeFileSync(join(root, "pkg/users.go"), "package users\nfunc GetUser(id string, force bool) string { return id }\n");
    expect(checkProject(root, goConfig).findings[0]?.rule).toBe("L3-reshaped");
  });

  it("infers Python fence local types from assignments", () => {
    const root = tempProject({
      "pyproject.toml": '[project]\nname = "httpx"\n',
      "httpx/__init__.py": "",
      "httpx/_client.py": "class Client:\n    def get(self, url: str) -> Response:\n        return Response()\n",
      "httpx/_models.py": "class Response:\n    def json(self) -> dict:\n        return {}\n",
      "docs/api.md": "```pycon\n>>> import httpx\n>>> client = httpx.Client()\n>>> response = client.get(\"/\")\n>>> response.json()\n```\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending.map((binding) => binding.symbol.name)).toContain("json");
    expect(result.pending.find((binding) => binding.symbol.name === "json")?.anchor.token).toBe("Response.json");
  });

  it("binds Python class-qualified methods and attributes", () => {
    const root = tempProject({
      "pyproject.toml": '[project]\nname = "httpx"\n',
      "httpx/__init__.py": "",
      "httpx/_models.py": "class Response:\n    @property\n    def status_code(self) -> int:\n        return 200\n    def json(self):\n        return {}\n",
      "docs/api.md": "Call `Response.json()` and read `Response.status_code`.\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending.map((binding) => binding.symbol.name)).toEqual(
      expect.arrayContaining(["json", "status_code"]),
    );
    lockNow(root);
    writeFileSync(
      join(root, "httpx/_models.py"),
      "class Response:\n    @property\n    def status_code(self) -> int:\n        return 200\n    def json_data(self):\n        return {}\n",
    );
    expect(checkProject(root, config).findings[0]?.rule).toBe("L1-broken");
  });

  it("binds Go package selectors across files", () => {
    const root = tempProject({
      "go.mod": "module example.com/viper\n",
      "pkg/remote.go": "package viper\nfunc ReadRemoteConfig() error { return nil }\n",
      "pkg/viper.go": "package viper\nconst SupportedExts = \"yaml\"\n",
      "docs/api.md": "Call `viper.ReadRemoteConfig()` and read `viper.SupportedExts`.\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    const result = checkProject(root, goConfig);
    expect(result.findings).toEqual([]);
    expect(result.pending.map((binding) => binding.symbol.name)).toEqual(
      expect.arrayContaining(["ReadRemoteConfig", "SupportedExts"]),
    );
  });

  it("binds Go re-exported selectors", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "internal/client/client.go": "package client\ntype Client struct{}\nfunc (c *Client) Do() error { return nil }\n",
      "root.go": "package app\nimport \"example.com/app/internal/client\"\ntype Client = client.Client\n",
      "docs/api.md": "Call `app.Client.Do()`.\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    const result = checkProject(root, goConfig);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.name).toBe("Do");
  });

  it("binds Go re-exported variables and constants", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "internal/config/config.go": "package config\nconst Limit = 5\nvar ErrX = 1\n",
      "root.go": "package app\nimport \"example.com/app/internal/config\"\nconst Limit = config.Limit\nvar ErrX = config.ErrX\n",
      "docs/api.md": "Read `app.Limit` and `app.ErrX`.\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    const result = checkProject(root, goConfig);
    expect(result.findings).toEqual([]);
    expect(result.pending.map((binding) => binding.symbol.name)).toEqual(
      expect.arrayContaining(["Limit", "ErrX"]),
    );
  });

  it("binds Go methods declared in another file", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "pkg/types.go": "package users\ntype Team struct{}\n",
      "pkg/methods.go": "package users\nfunc (t *Team) Add(name string) {}\n",
      "docs/api.md": "Call `Team.Add(name)`.\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    const result = checkProject(root, goConfig);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.name).toBe("Add");
  });

  it("binds Rust macro invocations and generic type aliases", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "anyhow"\n',
      "src/lib.rs": [
        "pub type Result<T> = core::result::Result<T, Error>;",
        "pub struct Error;",
        "#[macro_export]",
        "macro_rules! anyhow { () => {} }",
        "",
      ].join("\n"),
      "README.md": "Call `anyhow!(msg)` and return `anyhow::Result<T>`.\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending.map((binding) => binding.symbol.name)).toEqual(
      expect.arrayContaining(["anyhow", "Result"]),
    );
  });

  it("accepts crate-qualified Rust paths without a move", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "anyhow"\n',
      "src/lib.rs": "pub type Result<T> = core::result::Result<T, Error>;\npub struct Error;\n",
      "docs/api.md": "Return `anyhow::Result<T>`.\n",
    });
    lockNow(root);
    expect(checkProject(root, config).findings).toEqual([]);
  });

  it("binds traits referenced in derive attributes", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "rsapp"\n',
      "src/lib.rs": "pub trait Serialize {}\n",
      "docs/api.md": "```rust\n#[derive(Serialize)]\npub struct Item;\n```\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.name).toBe("Serialize");
  });

  it("binds proc-macro derive names", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "rsapp"\n',
      "src/lib.rs": "#[proc_macro_derive(MyDerive)]\npub fn derive_my(input: TokenStream) -> TokenStream { input }\n",
      "docs/api.md": "```rust\n#[derive(MyDerive)]\npub struct Item;\n```\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.name).toBe("derive_my");
  });

  it("binds derive-generated Rust methods", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "rsapp"\n',
      "src/lib.rs": "#[derive(Clone, Default)]\npub struct Settings { pub name: String }\n",
      "docs/api.md": "Call `Settings::default()` and `Settings::clone()`.\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending.map((binding) => binding.symbol.name)).toEqual(expect.arrayContaining(["default", "clone"]));
  });

  it("binds Rust methods declared in another file", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "rsapp"\n',
      "src/lib.rs": "pub struct User;\npub mod users;\n",
      "src/users.rs": "impl User { pub fn display(&self) -> String { String::new() } }\n",
      "docs/api.md": "Call `User.display()`.\n",
    });
    const result = checkProject(root, config);
    expect(result.findings).toEqual([]);
    expect(result.pending[0]?.symbol.name).toBe("display");
  });

  it("detects Go receiver mutability changes", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "pkg/users.go": "package users\ntype User struct {}\nfunc (u *User) Rename(name string) {}\n",
      "docs/api.md": "Call `User.Rename(name)`.\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    lockNow(root, goConfig);
    writeFileSync(join(root, "pkg/users.go"), "package users\ntype User struct {}\nfunc (u User) Rename(name string) {}\n");
    expect(checkProject(root, goConfig).findings[0]?.rule).toBe("L3-reshaped");
  });

  it("checks Rust symbols", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "rsapp"\n',
      "src/lib.rs": "pub fn get_user(id: &str) -> Option<User> { None }\n",
      "docs/api.md": "Call `get_user(id)`.\n",
    });
    lockNow(root);
    writeFileSync(join(root, "src/lib.rs"), "pub fn fetch_user(id: &str) -> Option<User> { None }\n");
    expect(checkProject(root, config).findings[0]?.rule).toBe("L4-renamed");
  });

  it("checks Go symbols when enabled", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "pkg/users.go": "package users\nfunc GetUser(id string) string { return id }\n",
      "docs/api.md": "Call `GetUser(id)`.\n",
    });
    const goConfig = parseConfig({ languages: { go: true } });
    lockNow(root, goConfig);
    writeFileSync(join(root, "pkg/users.go"), "package users\nfunc GetUser(id string, force bool) string { return id }\n");
    expect(checkProject(root, goConfig).findings[0]?.rule).toBe("L3-reshaped");
  });

  it("advances lock generations", () => {
    const root = tempProject(files(userCode(), "# API\n\nCall `getUser(id)`.\n"));
    lockNow(root);
    expect(checkProject(root, config).lock.generation).toBe(1);
    expect(markLockAdvanced(checkProject(root, config).lock).generation).toBe(2);
  });
});
