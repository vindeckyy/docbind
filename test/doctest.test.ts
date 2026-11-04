import { describe, expect, it } from "vitest";
import { runDoctests } from "../src/doctest.js";
import { parseConfig } from "../src/config.js";
import { tempProject } from "./helpers.js";

const config = (over: Record<string, unknown> = {}) =>
  parseConfig({
    doctests: [
      { name: "ok", command: process.execPath, args: ["-e", ""] },
      { name: "bad", command: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"], docs: ["docs/api.md"] },
    ],
    ...over,
  });

describe("doctest findings", () => {
  it("reports failing commands with their doc target", () => {
    const root = tempProject({ "README.md": "# Docs\n" });
    const findings = runDoctests(root, config());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "D1-doctest",
      severity: "error",
      doc: { path: "docs/api.md", line: 1 },
    });
    expect(findings[0]?.message).toContain("bad failed (exit 3)");
    expect(findings[0]?.message).toContain("boom");
  });

  it("falls back to README, reports spawn errors, and handles empty reasons", () => {
    const root = tempProject({ "README.md": "# Docs\n" });
    const missing = runDoctests(
      root,
      parseConfig({ doctests: [{ name: "missing", command: "definitely-not-a-command", args: [] }] }),
    );
    expect(missing[0]?.doc.path).toBe("README.md");
    expect(missing[0]?.message).toContain("missing failed");
    const silent = runDoctests(
      root,
      parseConfig({ doctests: [{ name: "silent", command: process.execPath, args: ["-e", "process.exit(0)"] }] }),
    );
    expect(silent).toEqual([]);
  });

  it("honors off severity and missing commands", () => {
    const root = tempProject({ "README.md": "# Docs\n" });
    expect(runDoctests(root, config({ severity: { "D1-doctest": "off" } }))).toEqual([]);
    expect(runDoctests(root, parseConfig({ doctests: [] }))).toEqual([]);
  });
});
