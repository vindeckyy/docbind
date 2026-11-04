import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProject } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { clearCache } from "../src/cache.js";

const files = Number(process.argv.find((value) => value.startsWith("--files="))?.split("=")[1] ?? 200);
const functionsPerFile = Number(process.argv.find((value) => value.startsWith("--functions="))?.split("=")[1] ?? 100);
const root = mkdtempSync(join(tmpdir(), "docbind-perf-"));
try {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "perf" }));
  for (let file = 0; file < files; file += 1) {
    const lines = ["export interface Item { id: string; value: number }", ""];
    for (let index = 0; index < functionsPerFile; index += 1) {
      lines.push(`export function item${file}_${index}(id: string): Item {`);
      lines.push(`  return { id, value: ${index} };`);
      lines.push("}");
      lines.push("");
    }
    writeFileSync(join(root, "src", `module${file}.ts`), lines.join("\n"));
  }
  writeFileSync(join(root, "docs", "api.md"), "# API\n\nCall `item0_0(id)`.\n");
  const config = parseConfig({});
  const loc = files * functionsPerFile * 3;
  const cold = performance.now();
  checkProject(root, config);
  const coldMs = performance.now() - cold;
  const warm = performance.now();
  checkProject(root, config);
  const warmMs = performance.now() - warm;
  clearCache(root);
  console.log(`files=${files} functions=${files * functionsPerFile} loc~${loc}`);
  console.log(`cold=${(coldMs / 1000).toFixed(2)}s warm=${(warmMs / 1000).toFixed(2)}s target=<2.00s`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
