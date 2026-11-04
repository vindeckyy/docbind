import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { checkProject, markLockAdvanced } from "../src/check.js";
import { writeLock } from "../src/lock/write.js";
import { parseConfig } from "../src/config.js";
import { discoverCode } from "../src/discover.js";
import { extractSurface } from "../src/surface/index.js";
import type { Config, Symbol } from "../src/types.js";

interface Repo {
  name: string;
  url: string;
  config: Record<string, unknown>;
}

const REPOS: Repo[] = [
  {
    name: "click",
    url: "https://github.com/pallets/click.git",
    config: {
      languages: { typescript: false, python: true, rust: false, go: false },
      exclude: ["**/node_modules/**", "**/.git/**", "CHANGES*", "CHANGELOG*", "HISTORY*"],
    },
  },
  {
    name: "chalk",
    url: "https://github.com/chalk/chalk.git",
    config: { languages: { typescript: true, python: false, rust: false, go: false } },
  },
  {
    name: "starlette",
    url: "https://github.com/encode/starlette.git",
    config: { languages: { typescript: false, python: true, rust: false, go: false } },
  },
  {
    name: "express",
    url: "https://github.com/expressjs/express.git",
    config: { languages: { typescript: true, python: false, rust: false, go: false } },
  },
  {
    name: "got",
    url: "https://github.com/sindresorhus/got.git",
    config: { languages: { typescript: true, python: false, rust: false, go: false } },
  },
  {
    name: "chi",
    url: "https://github.com/go-chi/chi.git",
    config: { languages: { typescript: false, python: false, rust: false, go: true } },
  },
];

const MONTHS = [
  "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01",
  "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01",
];
const root = join(process.cwd(), ".eval/history");
mkdirSync(root, { recursive: true });
const results = [];

function docLines(checkout: string, config: Config): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const doc of ["README.md", "README.rst", ...discoverCode(checkout, config).filter(() => false)]) {
    try {
      output.set(doc, readFileSync(join(checkout, doc), "utf8").split(/\r?\n/u));
    } catch {
      // Missing optional readme.
    }
  }
  return output;
}

for (const repo of REPOS) {
  const checkout = join(root, repo.name);
  if (!existsSync(join(checkout, ".git"))) {
    execFileSync("git", ["clone", "--quiet", "--filter=blob:none", repo.url, checkout], { stdio: "inherit" });
  }
  const git = (args: string[]): string => execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
  git(["checkout", "-q", "HEAD"]);
  const config: Config = parseConfig({ ...repo.config, cache: false });
  const commits = MONTHS.map((month) => git(["rev-list", "-1", `--before=${month}`, "HEAD"])).filter(Boolean);
  const intervals = [];
  for (let index = 1; index < commits.length; index += 1) {
    const previous = commits[index - 1] as string;
    const current = commits[index] as string;
    if (previous === current) continue;
    git(["checkout", "-q", previous]);
    const parent = checkProject(checkout, config);
    const parentDocs = new Map<string, string[]>();
    for (const [docPath] of parent.lock.anchors.reduce((map, entry) => map.set(entry.docPath, true), new Map<string, boolean>())) {
      try {
        parentDocs.set(docPath, readFileSync(join(checkout, docPath), "utf8").split(/\r?\n/u));
      } catch {
        parentDocs.set(docPath, []);
      }
    }
    writeLock(checkout, markLockAdvanced({ ...parent.lock, engine: "historical" }));
    git(["checkout", "-q", current]);
    const child = checkProject(checkout, config);
    const childSymbols: Symbol[] = extractSurface(checkout, discoverCode(checkout, config), config).symbols;
    const childIds = new Set(childSymbols.map((symbol) => symbol.id));
    let expected = 0;
    let detected = 0;
    const misses: Array<{ docPath: string; line?: number; token: string; symbol: string }> = [];
    for (const entry of parent.lock.anchors) {
      if (entry.line === undefined) continue;
      const before = parentDocs.get(entry.docPath)?.[entry.line - 1];
      let after: string | undefined;
      try {
        after = readFileSync(join(checkout, entry.docPath), "utf8").split(/\r?\n/u)[entry.line - 1];
      } catch {
        after = undefined;
      }
      if (before === undefined || before !== after) continue;
      if (childIds.has(entry.symbolId)) continue;
      expected += 1;
      const hit = child.findings.some(
        (finding) =>
          finding.doc.path === entry.docPath &&
          finding.doc.line === entry.line &&
          (finding.rule === "L1-broken" || finding.rule === "L2-moved" || finding.rule === "L4-renamed"),
      );
      if (hit) detected += 1;
      else misses.push({ docPath: entry.docPath, line: entry.line, token: entry.token, symbol: entry.qualifiedName });
    }
    intervals.push({ from: previous, to: current, expected, detected, missed: expected - detected, misses: misses.slice(0, 8) });
  }
  git(["checkout", "-q", "HEAD"]);
  const expected = intervals.reduce((sum, interval) => sum + interval.expected, 0);
  const detected = intervals.reduce((sum, interval) => sum + interval.detected, 0);
  results.push({ name: repo.name, url: repo.url, intervals, expected, detected });
  console.log(`${repo.name}: stale-doc removals=${expected} detected=${detected} missed=${expected - detected}`);
}
writeFileSync(join(process.cwd(), "corpus/historical.json"), `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), results }, null, 2)}\n`);
