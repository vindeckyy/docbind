import { checkStructure } from "../src/gates/structGate.js";

const result = checkStructure(process.cwd());
for (const check of result.checks) {
  if (!check.ok) console.log(`fail: ${check.name} (${check.detail})`);
}
console.log(
  `struct gate: ${result.checks.filter((check) => check.ok).length}/${result.checks.length} checks (${result.score.toFixed(2)}%), gate ${result.threshold}%`,
);
process.exit(result.pass ? 0 : 1);
