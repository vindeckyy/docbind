import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allExecutableLines,
  computeChangedCoverage,
  parseLcov,
  parseUnifiedDiff,
} from "../src/gates/changedCoverage.js";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const all = process.argv.includes("--all");
const base = option("--base", "HEAD~1");
const coveragePath = option("--coverage", "coverage/lcov.info");
const threshold = Number(option("--threshold", "95"));
const root = process.cwd();

const coverage = parseLcov(readFileSync(join(root, coveragePath), "utf8"));
let changed: Map<string, Set<number>>;
if (all) {
  changed = allExecutableLines(coverage);
} else {
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--unified=0", base], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.error(`changed-coverage: cannot diff against ${base}: ${(error as Error).message}`);
    process.exit(2);
  }
  changed = parseUnifiedDiff(diff);
}

const result = computeChangedCoverage(changed, coverage, threshold);
console.log(
  `changed-line coverage: ${result.covered}/${result.total} executable changed lines (${result.percent.toFixed(2)}%), gate ${threshold}%`,
);
for (const item of result.uncovered) {
  console.log(`uncovered: ${item.file}:${item.line}`);
}
process.exit(result.pass ? 0 : 1);
