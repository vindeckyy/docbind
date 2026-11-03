import { describe, expect, it } from "vitest";
import { checkProject, markLockAdvanced } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { writeLock } from "../src/lock/write.js";
import { explain } from "../src/explain.js";
import { tempProject } from "./helpers.js";

const config = parseConfig({});

describe("explain", () => {
  it("explains a bound anchor and its lock entry", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export function getUser(id: string): { id: string } { return { id }; }\n",
      "docs/api.md": "# API\n\nCall `getUser(id)`.\n",
    });
    const result = checkProject(root, config);
    writeLock(root, markLockAdvanced({ ...result.lock, engine: "0.1.0" }));
    const text = explain(root, config, { docPath: "docs/api.md", line: 3 });
    expect(text).toContain("token=\"getUser(id)\"");
    expect(text).toContain("bound: app|src/users|function|getUser|0");
    expect(text).toContain("lock:");
    expect(text).toContain("evidence:");
  });

  it("reports missing docs and anchors", () => {
    const root = tempProject({ "docs/api.md": "text\n" });
    expect(explain(root, config, { docPath: "docs/nope.md", line: 1 })).toContain("not found");
    expect(explain(root, config, { docPath: "docs/api.md", line: 99 })).toContain("no bindable anchor");
  });

  it("shows vetoes and unbound reasons", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/install.ts": "export function install(): void {}\n",
      "README.md": "Run `install` now.\n",
    });
    expect(explain(root, config, { docPath: "README.md", line: 1 })).toContain("vetoed: prose word");

    const unbound = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export function getUser(): void {}\n",
      "docs/api.md": "Call `missing`.\n",
    });
    expect(explain(unbound, config, { docPath: "docs/api.md", line: 1 })).toContain("unbound");
  });

  it("explains ambiguity and filters by column", () => {
    const root = tempProject({
      "packages/a/package.json": JSON.stringify({ name: "a" }),
      "packages/a/src/a.ts": "export function getUser(id: string): void {}\n",
      "packages/b/package.json": JSON.stringify({ name: "b" }),
      "packages/b/src/b.ts": "export function getUser(id: string): void {}\n",
      "docs/api.md": "Call `getUser(id)` and `getUser(id)`.\n",
    });
    const text = explain(root, config, { docPath: "docs/api.md", line: 1, column: 7 });
    expect(text).toContain("ambiguous");
    expect(text).toContain("candidate");
    expect(text).toContain("lock: no entry");
  });
});
