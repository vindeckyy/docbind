import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const target = process.argv.find((value) => value.startsWith("--target="))?.split("=")[1];
const suffix = target ? target.replace(/^bun-/u, "") : `${process.platform}-${process.arch}`;
const windows = suffix.startsWith("win");
const outfile = join(process.cwd(), "dist/bin", `docbind-${suffix}${windows ? ".exe" : ""}`);
mkdirSync(join(process.cwd(), "dist/bin"), { recursive: true });

const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
const command = bun.status === 0 ? "bun" : "npx";
const prefix = bun.status === 0 ? [] : ["--yes", "bun"];
const args = [...prefix, "build", "--compile", "src/main.ts", "--outfile", outfile];
if (target) args.push(`--target=${target}`);
const result = spawnSync(command, args, { stdio: "inherit", cwd: process.cwd() });
if (result.status !== 0) process.exit(result.status ?? 1);

const native = !target || target === `bun-${process.platform}-${process.arch}`;
if (native) {
  const version = spawnSync(outfile, ["--version"], { encoding: "utf8" });
  if (version.status !== 0) {
    console.error(version.stderr || "binary did not run");
    process.exit(1);
  }
  console.log(`${outfile} (${version.stdout.trim()})`);
} else {
  console.log(`${outfile} (${target})`);
}
console.log("Python extraction in the binary needs the python/ directory beside it or DOCBIND_PYTHON_WORKER.");
