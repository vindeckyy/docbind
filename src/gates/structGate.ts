import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export interface StructCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface StructResult {
  checks: StructCheck[];
  score: number;
  threshold: number;
  pass: boolean;
}

export const REQUIRED_FILES = [
  "package.json",
  "tsconfig.json",
  "vitest.config.ts",
  "README.md",
  ".gitignore",
  "python/docbind_extract.py",
  "src/cli.ts",
  "src/main.ts",
  "src/check.ts",
  "src/types.ts",
  "src/lock/schema.ts",
  "src/surface/index.ts",
  "src/surface/rust.ts",
  "src/surface/rustdoc.ts",
  "src/surface/go.ts",
  "src/surface/lex.ts",
  "src/shape/compat.ts",
  "src/docs/infer.ts",
  "src/resolve/score.ts",
  "src/report/sarif.ts",
  "src/gates/changedCoverage.ts",
  "scripts/changed-coverage.ts",
  "scripts/struct-gate.ts",
  "action/action.yml",
  "mkdocs.yml",
  "requirements-docs.txt",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  ".nvmrc",
  ".editorconfig",
  "assets/mark.svg",
  "examples/basic/docbind.json",
  "scripts/demo.ts",
  "scripts/corpus.ts",
  "corpus/repos.json",
  "corpus/README.md",
  "corpus/report.json",
  "docs/corpus.md",
  "docs/demo.md",
  "docs/index.md",
  "docs/usage.md",
  "docs/configuration.md",
  "docs/architecture.md",
  "docs/prior-art.md",
];

const REQUIRED_SCRIPTS = ["coverage", "gate:changed", "gate:struct", "gate", "test", "typecheck"];

const REQUIRED_EXPORTS: Array<{ file: string; marker: string }> = [
  { file: "src/check.ts", marker: "export function checkProject" },
  { file: "src/cli.ts", marker: "export async function runCli" },
  { file: "src/surface/index.ts", marker: "export function extractSurface" },
  { file: "src/surface/rust.ts", marker: "export function extractRust" },
  { file: "src/surface/rustdoc.ts", marker: "export function extractRustdoc" },
  { file: "src/surface/go.ts", marker: "export function extractGo" },
  { file: "src/lock/schema.ts", marker: "export function readLock" },
  { file: "src/lock/schema.ts", marker: "export function writeLock" },
  { file: "src/fix.ts", marker: "export function applyFixes" },
  { file: "src/explain.ts", marker: "export function explain" },
  { file: "src/docs/infer.ts", marker: "export function buildPythonTypeHints" },
  { file: "src/report/sarif.ts", marker: "export function formatSarif" },
];

const FORBIDDEN = [
  { pattern: "\\.only\\(", detail: "focused test" },
  { pattern: "describe\\.skip", detail: "skipped suite" },
  { pattern: "it\\.skip", detail: "skipped test" },
  { pattern: "test\\.skip", detail: "skipped test" },
  { pattern: "TODO", detail: "TODO marker" },
  { pattern: "FIXME", detail: "FIXME marker" },
];

export function walkFiles(root: string, directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(path.replace(/\\/gu, "/"));
  }
  return files.sort();
}

function read(root: string, path: string): string {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return "";
  }
}

export function coverageLines(root: string): Map<string, { total: number; hit: number }> {
  const path = join(root, "coverage/coverage-final.json");
  if (!existsSync(path)) return new Map();
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, { l?: Record<string, number> }>;
    const result = new Map<string, { total: number; hit: number }>();
    for (const [absolute, value] of Object.entries(data)) {
      const lines = Object.values(value.l ?? {});
      const hit = lines.filter((count) => count > 0).length;
      result.set(relative(root, absolute).replace(/\\/gu, "/"), { total: lines.length, hit });
    }
    return result;
  } catch {
    return new Map();
  }
}

export function checkStructure(root: string, threshold = 95): StructResult {
  const checks: StructCheck[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  for (const file of REQUIRED_FILES) {
    add(`file:${file}`, existsSync(join(root, file)), file);
  }

  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(read(root, "package.json")) as { scripts?: Record<string, string> };
    scripts = pkg.scripts ?? {};
  } catch {
    scripts = {};
  }
  for (const script of REQUIRED_SCRIPTS) {
    add(`script:${script}`, typeof scripts[script] === "string", scripts[script] ?? "missing");
  }

  for (const requirement of REQUIRED_EXPORTS) {
    add(
      `export:${requirement.file}:${requirement.marker}`,
      read(root, requirement.file).includes(requirement.marker),
      requirement.marker,
    );
  }

  const sourceFiles = walkFiles(root, "src").filter((file) => file.endsWith(".ts"));
  const testFiles = walkFiles(root, "test").filter((file) => file.endsWith(".test.ts"));
  add("tests:present", testFiles.length >= 10, `${testFiles.length} test files`);
  add("source:present", sourceFiles.length >= 15, `${sourceFiles.length} source files`);

  const sourceText = sourceFiles
    .filter((file) => file !== "src/gates/structGate.ts")
    .map((file) => read(root, file))
    .join("\n");
  const testText = testFiles.map((file) => read(root, file)).join("\n");
  for (const rule of FORBIDDEN) {
    const sourceHit = new RegExp(rule.pattern, "u").test(sourceText);
    const testHit = new RegExp(rule.pattern, "u").test(testText);
    add(`forbidden:${rule.detail}`, !sourceHit && !testHit, rule.detail);
  }

  const coverage = coverageLines(root);
  if (coverage.size === 0) {
    add("coverage:present", false, "coverage/coverage-final.json missing");
  } else {
    add("coverage:present", true, `${coverage.size} files`);
    const excluded = new Set(["src/main.ts", "src/types.ts", "src/surface/protocol.ts"]);
    let below = 0;
    let counted = 0;
    for (const file of sourceFiles) {
      if (excluded.has(file)) continue;
      const entry = coverage.get(file);
      if (!entry || entry.total === 0) continue;
      counted += 1;
      const percent = (entry.hit / entry.total) * 100;
      if (percent < 80) below += 1;
    }
    add("coverage:per-file", below === 0, `${counted} files at or above 80% line coverage`);
  }

  add("readme:commands", read(root, "README.md").includes("docbind check"), "docbind check documented");
  add(
    "python:worker",
    read(root, "python/docbind_extract.py").includes("def main"),
    "python worker entry point",
  );
  add(
    "action:check",
    read(root, "action/action.yml").includes("docbind check"),
    "composite action runs check",
  );

  const passed = checks.filter((check) => check.ok).length;
  const score = checks.length === 0 ? 0 : (passed / checks.length) * 100;
  return { checks, score, threshold, pass: score >= threshold };
}
