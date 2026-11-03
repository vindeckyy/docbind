import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkProject } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { discoverCode, discoverDocs } from "../src/discover.js";
import { extractSurface } from "../src/surface/index.js";

const root = process.cwd();
const candidates = [".corpus/httpx", ".corpus/viper", ".corpus/thiserror"];
const runs = 5;

interface Row {
  name: string;
  files: number;
  docs: number;
  symbols: number;
  anchors: number;
  medianMs: number;
}

const rows: Row[] = [];
for (const candidate of candidates) {
  const directory = join(root, candidate);
  if (!existsSync(join(directory, "docbind.json"))) continue;
  const config = parseConfig(JSON.parse(readFileSync(join(directory, "docbind.json"), "utf8")));
  const files = discoverCode(directory, config);
  const docs = discoverDocs(directory, config);
  const surface = extractSurface(directory, files, config);
  const timings: number[] = [];
  let anchors = 0;
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    const result = checkProject(directory, config);
    timings.push(performance.now() - start);
    anchors = result.stats.anchors;
  }
  timings.sort((left, right) => left - right);
  rows.push({
    name: candidate.replace(".corpus/", ""),
    files: files.length,
    docs: docs.length,
    symbols: surface.symbols.length,
    anchors,
    medianMs: timings[Math.floor(timings.length / 2)] as number,
  });
}

console.log("repo\tcodeFiles\tdocs\tsymbols\tanchors\tmedianMs\tanchorsPerSecond");
for (const row of rows) {
  console.log(
    [
      row.name,
      row.files,
      row.docs,
      row.symbols,
      row.anchors,
      row.medianMs.toFixed(1),
      Math.round((row.anchors / row.medianMs) * 1000),
    ].join("\t"),
  );
}
