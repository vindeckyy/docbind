import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkProject } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { discoverCode, discoverDocs } from "../src/discover.js";
import { parseDocs } from "../src/docs/parse.js";
import { buildGoTypeHints, buildPythonTypeHints } from "../src/docs/infer.js";
import { parseToken } from "../src/resolve/score.js";
import { readLock } from "../src/lock/schema.js";
import { extractSurface } from "../src/surface/index.js";
import { lex } from "../src/surface/lex.js";
import { findMatching } from "../src/surface/syntax.js";
import { runCli } from "../src/cli.js";
import type { Config, Finding, Symbol } from "../src/types.js";

interface CorpusEntry {
  name: string;
  repo: string;
  commit: string;
  local?: string;
  docs: string[];
  exclude: string[];
  languages: Config["languages"];
  docstrings?: boolean;
  asciidoc?: boolean;
  javadoc?: boolean;
  mutations: number;
  valueMutations?: Array<{
    file: string;
    find: string;
    replace: string;
    symbol: string;
    expectedRule?: string;
  }>;
  annotationMutations?: Array<{
    file: string;
    annotation: string;
    from: string;
    to: string;
    symbol: string;
    expectedRule?: string;
  }>;
  enumMutations?: Array<{
    file: string;
    constant: string;
    from: string;
    to: string;
    symbol: string;
    expectedRule?: string;
  }>;
}

interface MutationResult {
  symbol: string;
  kind?: "rename" | "value" | "annotation" | "enum";
  expectedRule?: string;
  rule?: string;
  hit: boolean;
  findings: number;
  relatedRules: string[];
  collateral: number;
  collateralRules: string[];
}

interface RepoReport {
  name: string;
  repo: string;
  commit: string;
  nameOnlyFalsePositives: number;
  docs: number;
  anchors: number;
  bound: number;
  bindRate: number;
  baselineFindings: number;
  baselineRules: string[];
  docEditFindings: number;
  docEditRules: string[];
  mutations: MutationResult[];
  hits: number;
  misses: number;
  collateral: number;
}

const root = process.cwd();
const cache = join(root, ".corpus");
const args = process.argv.slice(2);
const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const only = onlyArg ? new Set(onlyArg.split(",")) : undefined;
const refresh = args.includes("--refresh");
const localOnly = args.includes("--local-only");
const strict = args.includes("--strict");
const thresholdArg = args.includes("--threshold") ? Number(args[args.indexOf("--threshold") + 1]) : undefined;
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : "corpus/report.json";
const entries = JSON.parse(readFileSync(join(root, "corpus/repos.json"), "utf8")) as CorpusEntry[];
const selected = entries
  .filter((entry) => !only || only.has(entry.name))
  .filter((entry) => !localOnly || Boolean(entry.local));

function capture(): { stdout: (value: string) => void; stderr: (value: string) => void; text: () => string } {
  const lines: string[] = [];
  return {
    stdout: (value) => lines.push(value),
    stderr: (value) => lines.push(value),
    text: () => lines.join("\n"),
  };
}

async function materialize(entry: CorpusEntry): Promise<string> {
  const target = join(cache, entry.name);
  if (!refresh) {
    try {
      readFileSync(join(target, "corpus.ready"), "utf8");
      writeFileSync(
        join(target, "docbind.json"),
        `${JSON.stringify({
          docs: entry.docs,
          exclude: entry.exclude,
          languages: entry.languages,
          ...(entry.docstrings ? { docstrings: true } : {}),
    ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.javadoc ? { javadoc: true } : {}),
        ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.javadoc ? { javadoc: true } : {}),
        ...(entry.javadoc ? { javadoc: true } : {}),
          ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.javadoc ? { javadoc: true } : {}),
        ...(entry.javadoc ? { javadoc: true } : {}),
          ...(entry.javadoc ? { javadoc: true } : {}),
          ...(thresholdArg !== undefined ? { minConfidence: thresholdArg } : {}),
        }, null, 2)}\n`,
      );
      return target;
    } catch {
      // Download below.
    }
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  if (entry.local) {
    cpSync(join(root, entry.local), target, { recursive: true });
    writeFileSync(
      join(target, "docbind.json"),
      `${JSON.stringify({
        docs: entry.docs,
        exclude: entry.exclude,
        languages: entry.languages,
        ...(entry.docstrings ? { docstrings: true } : {}),
    ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.javadoc ? { javadoc: true } : {}),
        ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.javadoc ? { javadoc: true } : {}),
        ...(entry.javadoc ? { javadoc: true } : {}),
        ...(thresholdArg !== undefined ? { minConfidence: thresholdArg } : {}),
      }, null, 2)}\n`,
    );
    writeFileSync(join(target, "corpus.ready"), entry.commit);
    return target;
  }
  const response = await fetch(`https://codeload.github.com/${entry.repo}/tar.gz/${entry.commit}`);
  if (!response.ok) throw new Error(`${entry.name}: download failed with ${response.status}`);
  const archive = join(mkdtempSync(join(tmpdir(), "docbind-corpus-")), "repo.tar.gz");
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  const unpack = spawnSync("tar", ["-xzf", archive, "-C", target, "--strip-components=1"], {
    stdio: "inherit",
  });
  if (unpack.status !== 0) throw new Error(`${entry.name}: tar failed`);
  writeFileSync(
    join(target, "docbind.json"),
    `${JSON.stringify({
      docs: entry.docs,
      exclude: entry.exclude,
      languages: entry.languages,
      ...(entry.docstrings ? { docstrings: true } : {}),
    ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
      ...(entry.javadoc ? { javadoc: true } : {}),
      ...(thresholdArg !== undefined ? { minConfidence: thresholdArg } : {}),
    }, null, 2)}\n`,
  );
  writeFileSync(join(target, "corpus.ready"), entry.commit);
  return target;
}

interface JavaToken {
  value: string;
  start: number;
  end: number;
}

function replaceStringInParens(
  source: string,
  tokens: JavaToken[],
  open: number,
  label: string,
  from: string,
  to: string,
): string {
  const close = findMatching(tokens, open, "(", ")");
  if (close < 0) throw new Error(`unclosed arguments: ${label}`);
  const bodyStart = tokens[open]?.end as number;
  const bodyEnd = tokens[close]?.start as number;
  const body = source.slice(bodyStart, bodyEnd);
  const matches = [...body.matchAll(/"(?:\\\\.|[^"\\\\])*"/gu)]
    .map((match) => ({ text: match[0], index: match.index as number }))
    .filter((match) => {
      try {
        return JSON.parse(match.text) === from;
      } catch {
        return false;
      }
    });
  if (matches.length !== 1) throw new Error(`expected one ${JSON.stringify(from)} in ${label}, found ${matches.length}`);
  const match = matches[0] as { text: string; index: number };
  const start = bodyStart + match.index;
  return `${source.slice(0, start)}${JSON.stringify(to)}${source.slice(start + match.text.length)}`;
}

function replaceAnnotationString(source: string, annotation: string, from: string, to: string): string {
  const tokens = lex(source, "java").tokens;
  let open = -1;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.value !== "@" || tokens[index + 1]?.value !== annotation) continue;
    const paren = tokens.findIndex((token, cursor) => cursor > index + 1 && token.value === "(");
    if (paren >= 0) {
      open = paren;
      break;
    }
  }
  if (open < 0) throw new Error(`annotation not found: @${annotation}`);
  return replaceStringInParens(source, tokens, open, `@${annotation}`, from, to);
}

function replaceEnumArgumentString(source: string, constant: string, from: string, to: string): string {
  const tokens = lex(source, "java").tokens;
  const index = tokens.findIndex((token) => token.value === constant);
  if (index < 0) throw new Error(`enum constant not found: ${constant}`);
  const open = tokens[index + 1]?.value === "(" ? index + 1 : -1;
  if (open < 0) throw new Error(`enum constant has no arguments: ${constant}`);
  return replaceStringInParens(source, tokens, open, `enum constant ${constant}`, from, to);
}

function mutationTarget(symbol: Symbol): { path: string; lineIndex: number } | undefined {
  let text: string;
  try {
    text = readFileSync(join(".", symbol.filePath), "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/u);
  const start = Math.max(0, symbol.line - 1);
  const pattern = new RegExp(`\\b${symbol.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u");
  for (let index = start; index < lines.length; index += 1) {
    if (pattern.test(lines[index] ?? "")) return { path: symbol.filePath, lineIndex: index };
  }
  for (let index = start - 1; index >= 0; index -= 1) {
    if (pattern.test(lines[index] ?? "")) return { path: symbol.filePath, lineIndex: index };
  }
  return undefined;
}

function mutate(symbol: Symbol): (() => void) | undefined {
  const target = mutationTarget(symbol);
  if (!target) return undefined;
  const path = join(".", target.path);
  const original = readFileSync(path, "utf8");
  const lines = original.split(/\r?\n/u);
  const mutation = `${symbol.name}Mutation`;
  const pattern = new RegExp(`\\b${symbol.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u");
  lines[target.lineIndex] = (lines[target.lineIndex] ?? "").replace(pattern, mutation);
  writeFileSync(path, lines.join("\n"));
  return () => writeFileSync(path, original);
}

function findingsFor(rootDir: string, config: Config): Finding[] {
  return checkProject(rootDir, config).findings;
}

const report: RepoReport[] = [];

for (const entry of selected) {
  console.log(`\n[corpus] ${entry.name} ${entry.commit.slice(0, 8)}`);
  const checkout = await materialize(entry);
  process.chdir(checkout);
  const config = parseConfig({
    docs: entry.docs,
    exclude: entry.exclude,
    languages: entry.languages,
    ...(entry.docstrings ? { docstrings: true } : {}),
    ...(entry.asciidoc ? { asciidoc: true } : {}),
    ...(entry.javadoc ? { javadoc: true } : {}),
    ...(thresholdArg !== undefined ? { minConfidence: thresholdArg } : {}),
  });
  const lockRun = capture();
  const lockCode = await runCli(["lock", "--refresh"], {
    cwd: checkout,
    stdout: lockRun.stdout,
    stderr: lockRun.stderr,
  });
  if (lockCode !== 0) {
    console.error(lockRun.text());
    throw new Error(`${entry.name}: lock failed`);
  }

  const baseline = checkProject(checkout, config);
  const lock = readLock(checkout);
  const surface = extractSurface(checkout, discoverCode(checkout, config), config);
  const byId = new Map(surface.symbols.map((symbol) => [symbol.id, symbol]));
  const symbolNames = new Set(surface.symbols.map((symbol) => symbol.name));
  const parsedAnchors = parseDocs(
    checkout,
    discoverDocs(checkout, config),
    buildPythonTypeHints(surface.symbols),
    buildGoTypeHints(surface.symbols),
  ).anchors;
  const nameOnlyFalsePositives = parsedAnchors.filter(
    (anchor) => !symbolNames.has(parseToken(anchor.token).base),
  ).length;
  const unique = [...new Map(lock.anchors.map((anchor) => [anchor.symbolId, anchor])).values()]
    .map((anchor) => byId.get(anchor.symbolId))
    .filter((symbol): symbol is Symbol => Boolean(symbol))
    .filter((symbol) => symbol!.name.length > 2 && !symbol!.name.endsWith("Mutation"))
    .slice(0, entry.mutations);

  let docEditFindings = 0;
  let docEditRules: string[] = [];
  const firstAnchor = lock.anchors[0];
  if (firstAnchor) {
    const docPath = join(".", firstAnchor.docPath);
    const originalDoc = readFileSync(docPath, "utf8");
    const docLines = originalDoc.split(/\r?\n/u);
    const anchorLine = docLines[firstAnchor.line - 1] ?? "";
    if (anchorLine.length > 0) {
      docLines[firstAnchor.line - 1] = `${anchorLine} updated`;
      writeFileSync(docPath, docLines.join("\n"));
      try {
        const findings = findingsFor(checkout, config);
        docEditFindings = findings.length;
        docEditRules = [...new Set(findings.map((finding) => finding.rule))];
      } finally {
        writeFileSync(docPath, originalDoc);
      }
    }
  }

  const mutations: MutationResult[] = [];
  for (const symbol of unique) {
    const restore = mutate(symbol);
    if (!restore) continue;
    try {
      const findings = findingsFor(checkout, config);
      const relatedAnchors = lock.anchors.filter((anchor) =>
        anchor.symbolId === symbol.id ||
        anchor.qualifiedName === symbol.qualifiedName ||
        anchor.qualifiedName.startsWith(`${symbol.qualifiedName}.`)
      );
      const relatedIds = new Set(relatedAnchors.map((anchor) => anchor.symbolId));
      const relatedNames = new Set(relatedAnchors.map((anchor) => anchor.name));
      const relatedFindings = findings.filter((finding) =>
        (finding.code && relatedIds.has(finding.code.symbolId)) ||
        [...relatedNames].some((name) => finding.message.includes(name)) ||
        finding.message.includes(symbol.name)
      );
      const collateralFindings = findings.filter((finding) => !relatedFindings.includes(finding));
      mutations.push({
        symbol: symbol.name,
        rule: relatedFindings[0]?.rule,
        hit: relatedFindings.length > 0,
        findings: findings.length,
        relatedRules: [...new Set(relatedFindings.map((finding) => finding.rule))],
        collateral: collateralFindings.length,
        collateralRules: [...new Set(collateralFindings.map((finding) => finding.rule))],
      });
    } finally {
      restore();
    }
  }

  for (const valueMutation of entry.valueMutations ?? []) {
    const path = join(".", valueMutation.file);
    const original = readFileSync(path, "utf8");
    if (!original.includes(valueMutation.find)) {
      throw new Error(`${entry.name}: value mutation target not found: ${valueMutation.find}`);
    }
    writeFileSync(path, original.replace(valueMutation.find, valueMutation.replace));
    try {
      const findings = findingsFor(checkout, config);
      const relatedFindings = findings.filter((finding) => finding.message.includes(valueMutation.symbol));
      const collateralFindings = findings.filter((finding) => !relatedFindings.includes(finding));
      const ruleMatched = valueMutation.expectedRule
        ? relatedFindings.some((finding) => finding.rule === valueMutation.expectedRule)
        : relatedFindings.length > 0;
      mutations.push({
        symbol: valueMutation.symbol,
        kind: "value",
        ...(valueMutation.expectedRule ? { expectedRule: valueMutation.expectedRule } : {}),
        rule: relatedFindings[0]?.rule,
        hit: ruleMatched,
        findings: findings.length,
        relatedRules: [...new Set(relatedFindings.map((finding) => finding.rule))],
        collateral: collateralFindings.length,
        collateralRules: [...new Set(collateralFindings.map((finding) => finding.rule))],
      });
    } finally {
      writeFileSync(path, original);
    }
  }

  for (const annotationMutation of entry.annotationMutations ?? []) {
    const path = join(".", annotationMutation.file);
    const original = readFileSync(path, "utf8");
    writeFileSync(
      path,
      replaceAnnotationString(original, annotationMutation.annotation, annotationMutation.from, annotationMutation.to),
    );
    try {
      const findings = findingsFor(checkout, config);
      const relatedFindings = findings.filter((finding) => finding.message.includes(annotationMutation.symbol));
      const collateralFindings = findings.filter((finding) => !relatedFindings.includes(finding));
      const ruleMatched = annotationMutation.expectedRule
        ? relatedFindings.some((finding) => finding.rule === annotationMutation.expectedRule)
        : relatedFindings.length > 0;
      mutations.push({
        symbol: annotationMutation.symbol,
        kind: "annotation",
        ...(annotationMutation.expectedRule ? { expectedRule: annotationMutation.expectedRule } : {}),
        rule: relatedFindings[0]?.rule,
        hit: ruleMatched,
        findings: findings.length,
        relatedRules: [...new Set(relatedFindings.map((finding) => finding.rule))],
        collateral: collateralFindings.length,
        collateralRules: [...new Set(collateralFindings.map((finding) => finding.rule))],
      });
    } finally {
      writeFileSync(path, original);
    }
  }

  for (const enumMutation of entry.enumMutations ?? []) {
    const path = join(".", enumMutation.file);
    const original = readFileSync(path, "utf8");
    writeFileSync(
      path,
      replaceEnumArgumentString(original, enumMutation.constant, enumMutation.from, enumMutation.to),
    );
    try {
      const findings = findingsFor(checkout, config);
      const relatedFindings = findings.filter((finding) => finding.message.includes(enumMutation.symbol));
      const collateralFindings = findings.filter((finding) => !relatedFindings.includes(finding));
      const ruleMatched = enumMutation.expectedRule
        ? relatedFindings.some((finding) => finding.rule === enumMutation.expectedRule)
        : relatedFindings.length > 0;
      mutations.push({
        symbol: enumMutation.symbol,
        kind: "enum",
        ...(enumMutation.expectedRule ? { expectedRule: enumMutation.expectedRule } : {}),
        rule: relatedFindings[0]?.rule,
        hit: ruleMatched,
        findings: findings.length,
        relatedRules: [...new Set(relatedFindings.map((finding) => finding.rule))],
        collateral: collateralFindings.length,
        collateralRules: [...new Set(collateralFindings.map((finding) => finding.rule))],
      });
    } finally {
      writeFileSync(path, original);
    }
  }

  const anchors = baseline.stats.anchors;
  report.push({
    name: entry.name,
    repo: entry.repo,
    commit: entry.commit,
    nameOnlyFalsePositives,
    docs: baseline.stats.docsScanned,
    anchors,
    bound: baseline.stats.bound,
    bindRate: anchors === 0 ? 0 : baseline.stats.bound / anchors,
    baselineFindings: baseline.findings.length,
    baselineRules: [...new Set(baseline.findings.map((finding) => finding.rule))],
    docEditFindings,
    docEditRules,
    mutations,
    hits: mutations.filter((mutation) => mutation.hit).length,
    misses: mutations.filter((mutation) => !mutation.hit).length,
    collateral: mutations.reduce((sum, mutation) => sum + mutation.collateral, 0),
  });
}

const outPath = isAbsolute(outArg) ? outArg : join(root, outArg);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)}\n`);

console.log("\ncorpus summary");
for (const item of report) {
  console.log(
    `${item.name}: docs=${item.docs} anchors=${item.anchors} bound=${item.bound} ` +
    `baselineFindings=${item.baselineFindings} docEditFindings=${item.docEditFindings} mutations=${item.mutations.length} ` +
    `hits=${item.hits} misses=${item.misses} collateral=${item.collateral} nameOnlyFP=${item.nameOnlyFalsePositives}`,
  );
}

if (strict) {
  const failures: string[] = [];
  for (const item of report) {
    if (item.baselineFindings > 0) failures.push(`${item.name}: ${item.baselineFindings} baseline findings`);
    if (item.docEditFindings > 0) failures.push(`${item.name}: ${item.docEditFindings} doc-edit findings`);
    if (item.misses > 0) failures.push(`${item.name}: ${item.misses} missed mutations`);
    if (item.collateral > 0) failures.push(`${item.name}: ${item.collateral} collateral findings`);
  }
  if (failures.length > 0) {
    console.error(`\nstrict corpus failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
}
