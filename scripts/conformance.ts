import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProject, markLockAdvanced } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { writeLock } from "../src/lock/write.js";
import type { Config } from "../src/types.js";

interface Expectation {
  rule: string;
  severity: string;
}

interface Case {
  lock?: boolean;
  config?: Record<string, unknown>;
  baseline?: Expectation[];
  expect: Expectation[];
}

const root = join(process.cwd(), "conformance/cases");
const names = process.argv.slice(2).filter((value) => !value.startsWith("-"));
const cases = names.length > 0 ? names : readFileSync(join(root, "cases.txt"), "utf8").split(/\r?\n/u).filter(Boolean);
let failures = 0;

for (const name of cases) {
  const caseRoot = join(root, name);
  const spec = JSON.parse(readFileSync(join(caseRoot, "case.json"), "utf8")) as Case;
  const workspace = mkdtempSync(join(tmpdir(), `docbind-conformance-${name}-`));
  try {
    cpSync(join(caseRoot, "files"), workspace, { recursive: true });
    const config: Config = parseConfig(spec.config ?? {});
    if (spec.lock !== false) {
      const baseline = checkProject(workspace, config);
      writeLock(workspace, markLockAdvanced({ ...baseline.lock, engine: "conformance" }));
    }
    const baseline = checkProject(workspace, config);
    const baselineActual = baseline.findings.map((finding) => ({ rule: finding.rule, severity: finding.severity }));
    const baselineExpected = spec.baseline ?? [];
    const baselineMatches =
      baselineActual.length === baselineExpected.length &&
      baselineExpected.every((want) =>
        baselineActual.some((got) => got.rule === want.rule && got.severity === want.severity),
      );
    if (!baselineMatches) {
      failures += 1;
      console.error(`FAIL ${name} baseline`);
      console.error(`  expected: ${JSON.stringify(baselineExpected)}`);
      console.error(`  actual:   ${JSON.stringify(baselineActual)}`);
      continue;
    }
    const mutation = join(caseRoot, "mutation");
    try {
      cpSync(mutation, workspace, { recursive: true });
    } catch {
      // Cases without mutations only assert the baseline.
    }
    const result = checkProject(workspace, config);
    const actual = result.findings.map((finding) => ({ rule: finding.rule, severity: finding.severity }));
    const expected = spec.expect;
    const matches =
      actual.length === expected.length &&
      expected.every((want) => actual.some((got) => got.rule === want.rule && got.severity === want.severity));
    if (!matches) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(`  expected: ${JSON.stringify(expected)}`);
      console.error(`  actual:   ${JSON.stringify(actual)}`);
    } else {
      console.log(`ok ${name}`);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

console.log(`${cases.length - failures}/${cases.length} conformance cases passed`);
process.exit(failures === 0 ? 0 : 1);
