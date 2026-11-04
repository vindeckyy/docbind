import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Mutation {
  symbol: string;
  kind?: string;
  mutationClass?: string;
  hit: boolean;
}

interface Case {
  name: string;
  docs: number;
  docLines: number;
  falsePositivePerKLine: number;
  mutations: Mutation[];
}

const root = process.cwd();
const report = (JSON.parse(readFileSync(join(root, "corpus/report.json"), "utf8")) as { report: Case[] }).report;
const entries = JSON.parse(readFileSync(join(root, "corpus/repos.json"), "utf8")) as Array<{
  name: string;
  languages: Record<string, boolean>;
}>;
const languageOf = (name: string): string => {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) return "unknown";
  const enabled = Object.entries(entry.languages)
    .filter(([key, value]) => value && key !== "rustdoc")
    .map(([key]) => key);
  if (enabled.length > 0) return enabled.join("+");
  if ((entry as { javadoc?: boolean }).javadoc) return "java";
  if ((entry as { docstrings?: boolean }).docstrings) return "python";
  return "none";
};
const classes = ["signature", "return", "visibility", "move", "kind"];
const groups = new Map<string, { hits: number; total: number }>();
for (const item of report) {
  const language = languageOf(item.name);
  for (const mutation of item.mutations) {
    if (mutation.kind !== "class" || !mutation.mutationClass) continue;
    const key = `${language}\u0000${mutation.mutationClass}`;
    const group = groups.get(key) ?? { hits: 0, total: 0 };
    group.total += 1;
    if (mutation.hit) group.hits += 1;
    groups.set(key, group);
  }
}
const languages = [...new Set([...groups.keys()].map((key) => key.split("\u0000")[0] as string))].sort();
console.log("language\tclass\thits\ttotal\trecall");
for (const language of languages) {
  for (const mutationClass of classes) {
    const group = groups.get(`${language}\u0000${mutationClass}`);
    if (!group) continue;
    console.log(`${language}\t${mutationClass}\t${group.hits}\t${group.total}\t${((group.hits / group.total) * 100).toFixed(1)}%`);
  }
}
const totals = [...groups.values()].reduce((sum, group) => ({ hits: sum.hits + group.hits, total: sum.total + group.total }), { hits: 0, total: 0 });
console.log(`all\tall\t${totals.hits}\t${totals.total}\t${((totals.hits / Math.max(1, totals.total)) * 100).toFixed(1)}%`);
const lines = report.reduce((sum, item) => sum + item.docLines, 0);
const findings = report.reduce((sum, item) => sum + item.falsePositivePerKLine * (item.docLines / 1000), 0);
console.log(`false positives per 1k doc lines\t${((findings / Math.max(1, lines / 1000))).toFixed(3)}`);
