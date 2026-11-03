import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPython } from "../src/surface/python.js";
import { extractSurface } from "../src/surface/index.js";
import { parseConfig } from "../src/config.js";
import { tempProject } from "./helpers.js";

function pythonProject(): string {
  return tempProject({
    "pyproject.toml": '[project]\nname = "pyapp"\n',
    "pkg/__init__.py": "from .users import get_user as fetch_user\n",
    "pkg/users.py": `
__all__ = ["get_user", "Client", "ROLE"]

ROLE: str = "admin"

def get_user(id: str, *, force: bool = False) -> dict:
    return {}

def _hidden():
    pass

class Client:
    version: str = "1"
    def request(self, path: str, **kwargs) -> dict:
        return {}
    @property
    def active(self) -> bool:
        return True
    def _private(self):
        pass

async def fetch(a, /, b=1, *args, c, **kwargs):
    return a
`,
    "pkg/bad.py": "def broken(",
  });
}

describe("Python surface", () => {
  it("extracts functions, classes, constants and aliases", () => {
    const root = pythonProject();
    const result = extractPython(root, ["pkg/users.py", "pkg/__init__.py", "pkg/bad.py"]);
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining([
      "get_user", "Client", "ROLE", "request", "active", "version",
    ]));
    expect(result.symbols.find((symbol) => symbol.name === "get_user")?.aliases).toContain("fetch_user");
    expect(result.symbols.find((symbol) => symbol.name === "get_user")?.shape.params?.map((param) => param.name)).toEqual([
      "id", "force",
    ]);
    expect(result.symbols.find((symbol) => symbol.name === "active")?.kind).toBe("property");
    expect(result.symbols.find((symbol) => symbol.name === "_hidden")).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === "_private")).toBeUndefined();
    expect(result.parseFailures).toBeGreaterThan(0);
  });

  it("handles empty file lists", () => {
    expect(extractPython("/tmp", [])).toEqual({ symbols: [], parseFailures: 0, filesScanned: 0 });
  });

  it("reports a missing interpreter", () => {
    const root = pythonProject();
    const previous = process.env.DOCBIND_PYTHON;
    process.env.DOCBIND_PYTHON = "/nonexistent/python";
    try {
      const result = extractPython(root, ["pkg/users.py"]);
      expect(result.symbols).toEqual([]);
      expect(result.error).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.DOCBIND_PYTHON;
      else process.env.DOCBIND_PYTHON = previous;
    }
  });

  it("handles malformed and failed extractor output", () => {
    const root = tempProject({ "pkg/a.py": "x = 1\n" });
    const fake = (name: string, body: string): string => {
      const path = join(root, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
      return path;
    };
    const previous = process.env.DOCBIND_PYTHON;
    try {
      process.env.DOCBIND_PYTHON = fake("empty.sh", "cat >/dev/null; printf '{}'");
      const empty = extractPython(root, ["pkg/a.py"]);
      expect(empty.symbols).toEqual([]);
      expect(empty.filesScanned).toBe(1);

      process.env.DOCBIND_PYTHON = fake("bad.sh", "cat >/dev/null; printf 'not json'");
      expect(extractPython(root, ["pkg/a.py"]).error).toContain("invalid python extractor output");

      process.env.DOCBIND_PYTHON = fake("fail.sh", "cat >/dev/null; echo boom >&2; exit 1");
      expect(extractPython(root, ["pkg/a.py"]).error).toContain("boom");

      process.env.DOCBIND_PYTHON = fake("silent.sh", "cat >/dev/null; exit 1");
      expect(extractPython(root, ["pkg/a.py"]).error).toBe("python extractor failed");
      const combined = extractSurface(root, ["pkg/a.py"], parseConfig({ languages: { typescript: false } }));
      expect(combined.error).toContain("python extractor failed");
    } finally {
      if (previous === undefined) delete process.env.DOCBIND_PYTHON;
      else process.env.DOCBIND_PYTHON = previous;
    }
  });

  it("combines rust and go only when enabled", () => {
    const root = tempProject({
      "Cargo.toml": '[package]\nname = "rsapp"\n',
      "src/a.rs": "pub fn rust_item() {}\n",
      "go.mod": "module example.com/goapp\n",
      "src/b.go": "package goapp\nfunc GoItem() {}\n",
    });
    const all = extractSurface(root, ["src/a.rs", "src/b.go"], parseConfig({ languages: { go: true } }));
    expect(all.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["rust_item", "GoItem"]));
    const noGo = extractSurface(root, ["src/a.rs", "src/b.go"], parseConfig({ languages: { go: false } }));
    expect(noGo.symbols.map((symbol) => symbol.name)).toEqual(["rust_item"]);
    const noRust = extractSurface(root, ["src/a.rs", "src/b.go"], parseConfig({ languages: { rust: false, go: true } }));
    expect(noRust.symbols.map((symbol) => symbol.name)).toEqual(["GoItem"]);
  });

  it("combines languages and respects config", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/a.ts": "export function ts(): void {}",
      "pkg/__init__.py": "",
      "pkg/users.py": "def py_func():\n    pass\n",
    });
    const all = extractSurface(root, ["src/a.ts", "pkg/users.py"], parseConfig({}));
    expect(all.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["ts", "py_func"]));
    const tsOnly = extractSurface(root, ["src/a.ts", "pkg/users.py"], parseConfig({ languages: { python: false } }));
    expect(tsOnly.symbols.map((symbol) => symbol.name)).toEqual(["ts"]);
    const none = extractSurface(root, ["pkg/users.py"], parseConfig({ languages: { typescript: false, python: false } }));
    expect(none.symbols).toEqual([]);
  });
});
