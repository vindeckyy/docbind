import { describe, expect, it } from "vitest";
import { formatFindingsJson, formatHuman } from "../src/report/human.js";
import { formatJson } from "../src/report/json.js";
import { formatSarif } from "../src/report/sarif.js";
import { formatGithub } from "../src/report/github.js";
import type { CheckResult, Finding } from "../src/types.js";

const finding: Finding = {
  id: "abc123",
  rule: "L3-reshaped",
  severity: "error",
  doc: { path: "docs/api.md", line: 4, column: 7, length: 7 },
  code: { path: "src/users.ts", line: 2, symbolId: "app|src/users|function|getUser|0" },
  message: "getUser changed",
  suggestion: "old\nnew",
  fix: { kind: "replaceToken", from: "getUser", to: "get_user" },
};

const result: CheckResult = {
  findings: [finding, { ...finding, id: "warn", rule: "S1-deprecated", severity: "warning" }],
  pending: [],
  stats: {
    docsScanned: 1,
    codeFilesScanned: 2,
    symbols: 3,
    anchors: 4,
    bound: 2,
    unbound: 2,
    parseFailures: 0,
  },
  lock: { schema: 1, engine: "0", generation: 0, anchors: [], tombstones: [] },
};

describe("reports", () => {
  it("formats human output", () => {
    const text = formatHuman(result, { color: false });
    expect(text).toContain("docs/api.md:4");
    expect(text).toContain("code: src/users.ts:2");
    expect(text).toContain("fix:  docbind fix --write");
    expect(text).toContain("1 errors, 1 warnings, 2 total");
    expect(text).not.toContain("note");
  });

  it("filters notes by default and includes them with all", () => {
    const withNote: CheckResult = {
      ...result,
      findings: [{ ...finding, severity: "note", rule: "S1-deprecated" }],
    };
    expect(formatHuman(withNote, { color: false })).not.toContain("note");
    expect(formatHuman(withNote, { color: false, all: true })).toContain("note");
  });

  it("omits optional code and fix fields", () => {
    const sparse = formatHuman({ ...result, findings: [{ ...finding, code: undefined, fix: undefined }] }, { color: false });
    expect(sparse).not.toContain("code:");
    expect(sparse).not.toContain("fix:");
    const sarif = JSON.parse(formatSarif([{ ...finding, code: undefined }]));
    expect(sarif.runs[0].results[0].relatedLocations).toBeUndefined();
  });

  it("formats JSON outputs", () => {
    expect(JSON.parse(formatJson([finding])).findings[0].id).toBe("abc123");
    expect(JSON.parse(formatFindingsJson([finding], result)).stats.bound).toBe(2);
  });

  it("formats SARIF", () => {
    const sarif = JSON.parse(formatSarif([finding]));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results[0]).toMatchObject({
      ruleId: "L3-reshaped",
      level: "error",
      partialFingerprints: { docbindFinding: "abc123" },
    });
    expect(sarif.runs[0].results[0].relatedLocations[0].physicalLocation.artifactLocation.uri).toBe("src/users.ts");
  });

  it("formats GitHub annotations with escaping", () => {
    const text = formatGithub([
      { ...finding, severity: "warning", message: "line\nbreak %" },
      { ...finding, severity: "note", message: "note" },
    ]);
    expect(text).toContain("::warning file=docs/api.md,line=4,col=7");
    expect(text).toContain("line%0Abreak %25");
    expect(text).toContain("::notice");
  });
});
