import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface SweepReport {
  name: string;
  anchors: number;
  bound: number;
  baselineFindings: number;
  docEditFindings: number;
  hits: number;
  misses: number;
  collateral: number;
  nameOnlyFalsePositives: number;
  mutations: Array<{ symbol: string; hit: boolean }>;
}

interface SweepRow {
  threshold: number;
  anchors: number;
  bound: number;
  bindRate: number;
  baselineFindings: number;
  docEditFindings: number;
  hits: number;
  selections: number;
  recall: number;
  nameOnlyFalsePositives: number;
  collateral: number;
}

const root = process.cwd();
const args = process.argv.slice(2);
const all = args.includes("--all");
const thresholdArg = args.includes("--thresholds") ? args[args.indexOf("--thresholds") + 1] : undefined;
const thresholds = thresholdArg
  ? thresholdArg.split(",").map(Number)
  : [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
const fixtures = "macro-fixture,go-package-fixture,go-cycle-fixture,python-fields-fixture,rst-fixture";
const reportPath = join(root, all ? "corpus/precision-external.json" : "corpus/precision.json");
const runs: Array<{ threshold: number; report: SweepReport[] }> = [];
const targets = new Set<string>();

mkdirSync(join(root, "corpus"), { recursive: true });
for (const threshold of thresholds) {
  const out = join(root, "corpus", `precision-${threshold.toFixed(2)}.json`);
  const run = spawnSync(
    "npx",
    [
      "tsx",
      "scripts/corpus.ts",
      ...(all ? [] : ["--local-only", "--only", fixtures]),
      "--threshold",
      String(threshold),
      "--out",
      out,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (run.status !== 0) process.exit(run.status ?? 1);
  const report = (JSON.parse(readFileSync(out, "utf8")) as { report: SweepReport[] }).report;
  runs.push({ threshold, report });
  for (const item of report) {
    for (const mutation of item.mutations) targets.add(`${item.name}\u0000${mutation.symbol}`);
  }
}

const rows: SweepRow[] = [];
for (const { threshold, report } of runs) {
  const totals = report.reduce(
    (sum, item) => ({
      anchors: sum.anchors + item.anchors,
      bound: sum.bound + item.bound,
      baselineFindings: sum.baselineFindings + item.baselineFindings,
      docEditFindings: sum.docEditFindings + item.docEditFindings,
      hits: sum.hits + item.hits,
      mutations: sum.mutations + item.hits + item.misses,
      collateral: sum.collateral + item.collateral,
      nameOnlyFalsePositives: sum.nameOnlyFalsePositives + item.nameOnlyFalsePositives,
      hits: sum.hits + item.mutations.filter(
        (mutation) => mutation.hit && targets.has(`${item.name}\u0000${mutation.symbol}`)
      ).length,
    }),
    {
      anchors: 0,
      bound: 0,
      baselineFindings: 0,
      docEditFindings: 0,
      hits: 0,
      collateral: 0,
      nameOnlyFalsePositives: 0,
    },
  );
  rows.push({
    threshold,
    ...totals,
    bindRate: totals.anchors === 0 ? 0 : totals.bound / totals.anchors,
    selections: [...targets].filter((key) =>
      report.some((item) =>
        item.mutations.some((mutation) => `${item.name}\u0000${mutation.symbol}` === key)
      )
    ).length,
    recall: totals.hits / targets.size,
  });
}

writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), scope: all ? "all" : "local", fixtures: all ? "corpus/repos.json" : fixtures, rows }, null, 2)}\n`);
console.log("\nthreshold sweep");
console.log(`scope: ${all ? "all" : "local"}`);
console.log("threshold\tbound\tanchors\tbindRate\tbaseline\thits\ttargets\trecall\tnameOnlyFP\tcollateral");
for (const row of rows) {
  console.log(
    [
      row.threshold.toFixed(2),
      row.bound,
      row.anchors,
      `${(row.bindRate * 100).toFixed(1)}%`,
      row.baselineFindings,
      row.hits,
      targets.size,
      `${(row.recall * 100).toFixed(1)}%`,
      row.nameOnlyFalsePositives,
      row.collateral,
    ].join("\t"),
  );
}
