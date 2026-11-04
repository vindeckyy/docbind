import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { checkProject, markLockAdvanced } from "../src/check.js";
import { writeLock } from "../src/lock/write.js";
import { parseConfig } from "../src/config.js";
import type { Config } from "../src/types.js";

interface Repo {
  name: string;
  url: string;
  config: Record<string, unknown>;
  docs: string[];
}

const REPOS: Repo[] = [
  {
    name: "click",
    url: "https://github.com/pallets/click.git",
    config: {
      languages: { typescript: false, python: true, rust: false, go: false },
      exclude: ["**/node_modules/**", "**/.git/**", "CHANGES*", "CHANGELOG*", "HISTORY*", "docs/changes*", "docs/changelog*"],
    },
    docs: ["docs", "README.md", "README.rst"],
  },
  {
    name: "chalk",
    url: "https://github.com/chalk/chalk.git",
    config: { languages: { typescript: true, python: false, rust: false, go: false } },
    docs: ["docs", "readme.md", "README.md"],
  },
];

const MONTHS = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"];
const root = join(process.cwd(), ".eval/history");
mkdirSync(root, { recursive: true });
const results = [];

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
    const baseline = checkProject(checkout, config);
    writeLock(checkout, markLockAdvanced({ ...baseline.lock, engine: "case-study" }));
    const docsChanged = git(["diff", "--name-only", previous, current, "--", ...repo.docs]).split("\n").filter(Boolean);
    git(["checkout", "-q", current]);
    const result = checkProject(checkout, config);
    const byRule: Record<string, number> = {};
    for (const finding of result.findings) byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    intervals.push({
      from: previous,
      to: current,
      docsChanged: docsChanged.length,
      findings: result.findings.length,
      byRule,
      sample: result.findings.slice(0, 6).map((finding) => ({
        rule: finding.rule,
        docPath: finding.doc.path,
        line: finding.doc.line,
        severity: finding.severity,
        message: finding.message,
      })),
    });
  }
  git(["checkout", "-q", "HEAD"]);
  const total = intervals.reduce((sum, interval) => sum + interval.findings, 0);
  results.push({ name: repo.name, url: repo.url, intervals, total });
  console.log(`${repo.name}: intervals=${intervals.length} findings=${total} monthly=${intervals.map((interval) => interval.findings).join(",")}`);
}
writeFileSync(join(process.cwd(), "corpus/case-study.json"), `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), results }, null, 2)}\n`);
