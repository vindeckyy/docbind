import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allExecutableLines,
  computeChangedCoverage,
  parseLcov,
  parseUnifiedDiff,
} from "../src/gates/changedCoverage.js";
import { checkStructure, coverageLines, walkFiles } from "../src/gates/structGate.js";
import { tempProject } from "./helpers.js";

const lcov = `SF:src/a.ts
DA:1,1
DA:2,0
DA:3,2
end_of_record
SF:src/b.ts
DA:10,1
DA:11,0
end_of_record
`;

describe("changed-line coverage", () => {
  it("parses lcov records", () => {
    const parsed = parseLcov(lcov);
    expect(parsed.get("src/a.ts")?.get(1)).toBe(1);
    expect(parsed.get("src/a.ts")?.get(2)).toBe(0);
    expect(parsed.get("src/b.ts")?.get(10)).toBe(1);
    expect(allExecutableLines(parsed).get("src/a.ts")?.size).toBe(3);
  });

  it("parses unified diffs with hunks and deletions", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+added",
      "diff --git a/src/b.ts b/src/b.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
    ].join("\n");
    const parsed = parseUnifiedDiff(diff);
    expect([...parsed.get("src/a.ts") ?? []]).toEqual([1, 2]);
    expect(parsed.has("src/b.ts")).toBe(false);
    const single = parseUnifiedDiff("+++ b/x.ts\n@@ -5 +5 @@\n+x");
    expect([...single.get("x.ts") ?? []]).toEqual([5]);
  });

  it("computes coverage and enforces the threshold", () => {
    const parsed = parseLcov(lcov);
    const passing = computeChangedCoverage(new Map([["src/a.ts", new Set([1, 3])]]), parsed, 95);
    expect(passing).toMatchObject({ total: 2, covered: 2, percent: 100, pass: true });
    const failing = computeChangedCoverage(new Map([["src/a.ts", new Set([1, 2])]]), parsed, 95);
    expect(failing).toMatchObject({ total: 2, covered: 1, percent: 50, pass: false });
    expect(failing.uncovered).toEqual([{ file: "src/a.ts", line: 2 }]);
    const multi = computeChangedCoverage(
      new Map([["src/b.ts", new Set([11])], ["src/a.ts", new Set([2])]]),
      parsed,
      95,
    );
    expect(multi.uncovered.map((item) => item.file)).toEqual(["src/a.ts", "src/b.ts"]);
    const empty = computeChangedCoverage(new Map(), parsed, 95);
    expect(empty.percent).toBe(100);
    expect(empty.pass).toBe(true);
  });
});

describe("structure gate", () => {
  it("walks files", () => {
    const root = tempProject({ "src/a.ts": "", "src/nested/b.ts": "", "test/a.test.ts": "" });
    symlinkSync(join(root, "src/a.ts"), join(root, "src/link.ts"));
    expect(walkFiles(root, "src")).toEqual(["src/a.ts", "src/nested/b.ts"]);
    expect(walkFiles(root, "missing")).toEqual([]);
  });

  it("reads coverage reports", () => {
    const root = tempProject({ "src/a.ts": "" });
    mkdirSync(join(root, "coverage"), { recursive: true });
    writeFileSync(
      join(root, "coverage/coverage-final.json"),
      JSON.stringify({ [join(root, "src/a.ts")]: { l: { "1": 1, "2": 0 } } }),
    );
    expect(coverageLines(root).get("src/a.ts")).toEqual({ total: 2, hit: 1 });
    expect(coverageLines(tempProject({}))).toEqual(new Map());
    const noLines = tempProject({ "src/a.ts": "" });
    mkdirSync(join(noLines, "coverage"), { recursive: true });
    writeFileSync(join(noLines, "coverage/coverage-final.json"), JSON.stringify({ [join(noLines, "src/a.ts")]: {} }));
    expect(coverageLines(noLines).get("src/a.ts")).toEqual({ total: 0, hit: 0 });
    const broken = tempProject({ "coverage/coverage-final.json": "{" });
    expect(coverageLines(broken)).toEqual(new Map());
  });

  it("checks the real repository", () => {
    const result = checkStructure(process.cwd());
    expect(result.checks.length).toBeGreaterThan(20);
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.pass).toBe(true);
    expect(result.checks.find((check) => check.name === "file:README.md")?.ok).toBe(true);
  });

  it("reports low per-file coverage and missing structure", () => {
    const root = tempProject({ "src/a.ts": "" });
    mkdirSync(join(root, "coverage"), { recursive: true });
    writeFileSync(
      join(root, "coverage/coverage-final.json"),
      JSON.stringify({ [join(root, "src/a.ts")]: { l: { "1": 0 } } }),
    );
    const result = checkStructure(root);
    expect(result.pass).toBe(false);
    expect(result.checks.find((check) => check.name === "coverage:per-file")?.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "coverage:present")?.ok).toBe(true);

    const excluded = tempProject({
      "package.json": "{}",
      "src/main.ts": "",
      "src/a.ts": "",
    });
    mkdirSync(join(excluded, "coverage"), { recursive: true });
    writeFileSync(
      join(excluded, "coverage/coverage-final.json"),
      JSON.stringify({ [join(excluded, "src/a.ts")]: { l: {} } }),
    );
    const excludedResult = checkStructure(excluded);
    expect(excludedResult.checks.find((check) => check.name === "script:test")?.ok).toBe(false);
    expect(excludedResult.checks.find((check) => check.name === "coverage:per-file")?.ok).toBe(true);
  });
});
