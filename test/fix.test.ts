import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyFixes } from "../src/fix.js";
import type { Finding } from "../src/types.js";
import { tempProject } from "./helpers.js";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f",
    rule: "L4-renamed",
    severity: "error",
    doc: { path: "docs/api.md", line: 1, column: 7, length: 11 },
    message: "renamed",
    fix: { kind: "replaceToken", from: "getUser", to: "get_user" },
    ...over,
  };
}

describe("fix", () => {
  it("rewrites a token inside its span", () => {
    const root = tempProject({ "docs/api.md": "Call `getUser(id)` now.\n" });
    const result = applyFixes(root, [finding()]);
    expect(result.changedFiles).toEqual(["docs/api.md"]);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toBe("Call `get_user(id)` now.\n");
    expect(result.skipped).toEqual([]);
  });

  it("applies multiple edits in reverse order", () => {
    const root = tempProject({ "docs/api.md": "`getUser` and `getUser`\n" });
    const result = applyFixes(root, [
      finding({ id: "a", doc: { path: "docs/api.md", line: 1, column: 2, length: 7 } }),
      finding({ id: "b", doc: { path: "docs/api.md", line: 1, column: 16, length: 7 } }),
    ]);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toBe("`get_user` and `get_user`\n");
    expect(result.changedFiles).toEqual(["docs/api.md"]);
  });

  it("skips missing lines and tokens", () => {
    const root = tempProject({ "docs/api.md": "Call `getUser`.\n" });
    const result = applyFixes(root, [
      finding({ id: "line", doc: { path: "docs/api.md", line: 99, column: 1, length: 1 } }),
      finding({ id: "token", doc: { path: "docs/api.md", line: 1, column: 1, length: 6 } }),
    ]);
    expect(result.changedFiles).toEqual([]);
    expect(result.skipped.map((skip) => skip.reason)).toEqual([
      "line out of range",
      "token not found exactly once in span",
    ]);
  });

  it("skips a token that occurs twice in one span", () => {
    const root = tempProject({ "docs/api.md": "`getUser getUser`\n" });
    const result = applyFixes(root, [
      finding({ doc: { path: "docs/api.md", line: 1, column: 2, length: 16 } }),
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.changedFiles).toEqual([]);
  });

  it("ignores findings without a fix and preserves CRLF", () => {
    const root = tempProject({ "docs/api.md": "Call `getUser`.\r\n" });
    const result = applyFixes(root, [
      finding({ fix: undefined }),
      finding({ doc: { path: "docs/api.md", line: 1, column: 7, length: 7 } }),
    ]);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toBe("Call `get_user`.\r\n");
    expect(result.changedFiles).toEqual(["docs/api.md"]);
  });

  it("is idempotent", () => {
    const root = tempProject({ "docs/api.md": "`getUser`\n" });
    const first = applyFixes(root, [finding({ doc: { path: "docs/api.md", line: 1, column: 2, length: 7 } })]);
    const second = applyFixes(root, [finding({ doc: { path: "docs/api.md", line: 1, column: 2, length: 7 } })]);
    expect(first.changedFiles).toEqual(["docs/api.md"]);
    expect(second.changedFiles).toEqual([]);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toBe("`get_user`\n");
  });

  it("does nothing when no findings have fixes", () => {
    const root = tempProject({ "docs/api.md": "x" });
    expect(applyFixes(root, [finding({ fix: undefined })]).changedFiles).toEqual([]);
  });

  it("continues when a file has no edits", () => {
    const root = tempProject({ "docs/api.md": "x" });
    writeFileSync(join(root, "docs/api.md"), "x");
    expect(applyFixes(root, [finding({ doc: { path: "docs/api.md", line: 99, column: 1, length: 1 } })]).changedFiles).toEqual([]);
  });
});
