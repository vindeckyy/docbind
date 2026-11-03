import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkProject } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { discoverCode } from "../src/discover.js";
import { readLock } from "../src/lock/schema.js";
import { extractSurface } from "../src/surface/index.js";
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
  mutations: number;
}

interface MutationResult {
  symbol: string;
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
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const refresh = args.includes("--refresh");
const entries = JSON.parse(readFileSync(join(root, "corpus/repos.json"), "utf8")) as CorpusEntry[];
const selected = only ? entries.filter((entry) => entry.name === only) : entries;

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
      `${JSON.stringify({ docs: entry.docs, exclude: entry.exclude, languages: entry.languages }, null, 2)}\n`,
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
    `${JSON.stringify({ docs: entry.docs, exclude: entry.exclude, languages: entry.languages }, null, 2)}\n`,
  );
  writeFileSync(join(target, "corpus.ready"), entry.commit);
  return target;
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
  });
  const lockRun = capture();
  const lockCode = await runCli(["lock"], {
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

  const anchors = baseline.stats.anchors;
  report.push({
    name: entry.name,
    repo: entry.repo,
    commit: entry.commit,
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

mkdirSync(join(root, "corpus"), { recursive: true });
writeFileSync(join(root, "corpus/report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)}\n`);

console.log("\ncorpus summary");
for (const item of report) {
  console.log(
    `${item.name}: docs=${item.docs} anchors=${item.anchors} bound=${item.bound} ` +
    `baselineFindings=${item.baselineFindings} docEditFindings=${item.docEditFindings} mutations=${item.mutations.length} ` +
    `hits=${item.hits} misses=${item.misses} collateral=${item.collateral}`,
  );
}
