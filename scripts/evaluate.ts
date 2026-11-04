import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkProject, markLockAdvanced } from "../src/check.js";
import { discoverDocs } from "../src/discover.js";
import { writeLock } from "../src/lock/write.js";
import { parseConfig } from "../src/config.js";
import type { Config } from "../src/types.js";

interface HeldOutRepo {
  name: string;
  repo: string;
  commit: string;
  config: Record<string, unknown>;
  docs: number;
}

const REPOS: HeldOutRepo[] = [
  {
    name: "chalk",
    repo: "chalk/chalk",
    commit: "72110019e147683f60e13fa0ff5c14a0c27cd9fe",
    config: { languages: { typescript: true, python: false, rust: false, go: false } },
    docs: 0,
  },
  {
    name: "click",
    repo: "pallets/click",
    commit: "2247b35ea1c47c727d7a06e51fa280e12a863ff6",
    config: { languages: { typescript: false, python: true, rust: false, go: false } },
    docs: 0,
  },
  {
    name: "chi",
    repo: "go-chi/chi",
    commit: "9f8adb1aabaa8a91180a821111d3f8e668d1c0bf",
    config: { languages: { typescript: false, python: false, rust: false, go: true } },
    docs: 0,
  },
];

const root = join(process.cwd(), ".eval");
mkdirSync(root, { recursive: true });
const results = [];

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

for (const entry of REPOS) {
  const checkout = join(root, entry.name);
  if (!existsSync(join(checkout, ".ready"))) {
    rmSync(checkout, { recursive: true, force: true });
    mkdirSync(checkout, { recursive: true });
    const response = await fetch(`https://codeload.github.com/${entry.repo}/tar.gz/${entry.commit}`);
    if (!response.ok) throw new Error(`${entry.name}: download failed ${response.status}`);
    const archive = join(root, `${entry.name}.tar.gz`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const unpack = spawnSync("tar", ["-xzf", archive, "-C", checkout, "--strip-components=1"], { stdio: "inherit" });
    if (unpack.status !== 0) throw new Error(`${entry.name}: tar failed`);
    writeFileSync(join(checkout, ".ready"), entry.commit);
  }
  const config: Config = parseConfig({ ...entry.config, cache: false });
  rmSync(join(checkout, "docbind.lock.json"), { force: true });
  const baseline = checkProject(checkout, config);
  writeLock(checkout, markLockAdvanced({ ...baseline.lock, engine: "evaluation" }));
  const sample = baseline.pending
    .filter((binding) => existsSync(join(checkout, binding.symbol.filePath)))
    .slice(0, 6);
  const docLines = discoverDocs(checkout, config).reduce((sum, doc) => {
    try {
      return sum + readFileSync(join(checkout, doc), "utf8").split(/\r?\n/u).length;
    } catch {
      return sum;
    }
  }, 0);
  let hits = 0;
  let misses = 0;
  let collateral = 0;
  for (const binding of sample) {
    const sourcePath = join(checkout, binding.symbol.filePath);
    const original = readFileSync(sourcePath, "utf8");
    const lines = original.split(/\r?\n/u);
    const index = binding.symbol.line - 1;
    const line = lines[index] ?? "";
    const renamed = line.replace(new RegExp(`\\b${escape(binding.symbol.name)}\\b`, "u"), `${binding.symbol.name}Mutated`);
    if (renamed === line) continue;
    lines[index] = renamed;
    writeFileSync(sourcePath, lines.join("\n"));
    try {
      const mutated = checkProject(checkout, config);
      const before = new Set(baseline.findings.map((finding) => finding.id));
      const fresh = mutated.findings.filter((finding) => !before.has(finding.id));
      const related = fresh.filter(
        (finding) => finding.message.includes(binding.symbol.name) ||
          (finding.doc.path === binding.anchor.docPath && finding.doc.line === binding.anchor.line),
      );
      const hit = related.length > 0;
      collateral += fresh.length - related.length;
      if (hit) hits += 1;
      else misses += 1;
    } finally {
      writeFileSync(sourcePath, original);
    }
  }
  results.push({
    name: entry.name,
    repo: entry.repo,
    commit: entry.commit,
    docs: baseline.stats.docsScanned,
    docLines,
    anchors: baseline.stats.anchors,
    bound: baseline.stats.bound,
    unbound: baseline.stats.unbound,
    baselineFindings: baseline.findings.length,
    sampled: sample.length,
    hits,
    misses,
    collateral,
  });
  console.log(`${entry.name}: anchors=${baseline.stats.anchors} bound=${baseline.stats.bound} baseline=${baseline.findings.length} sampled=${sample.length} hits=${hits} misses=${misses} collateral=${collateral}`);
}
writeFileSync(join(process.cwd(), "corpus/evaluation.json"), `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), results }, null, 2)}\n`);
