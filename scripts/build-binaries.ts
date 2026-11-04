import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const platform = process.platform;
const arch = process.arch;
const suffix = platform === "win32" ? ".exe" : "";
const outfile = join(process.cwd(), "dist/bin", `docbind-${platform}-${arch}${suffix}`);
mkdirSync(join(process.cwd(), "dist/bin"), { recursive: true });

const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
const command = bun.status === 0 ? "bun" : "npx";
const prefix = bun.status === 0 ? [] : ["--yes", "bun"];
const result = spawnSync(
  command,
  [...prefix, "build", "--compile", "src/main.ts", "--outfile", outfile],
  { stdio: "inherit", cwd: process.cwd() },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const version = spawnSync(outfile, ["--version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(version.stderr || "binary did not run");
  process.exit(1);
}
console.log(`${outfile} (${version.stdout.trim()})`);
console.log("Python extraction in the binary needs the python/ directory beside it or DOCBIND_PYTHON_WORKER.");
