import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";

const root = mkdtempSync(join(tmpdir(), "docbind-demo-"));
const source = join(process.cwd(), "examples/basic");
cpSync(source, root, { recursive: true });

const run = async (args: string[]): Promise<void> => {
  console.log(`\n$ docbind ${args.join(" ")}`);
  const code = await runCli(args, { cwd: root });
  if (code !== 0 && code !== 1) process.exitCode = code;
};

try {
  await run(["lock"]);
  const users = readFileSync(join(root, "src/users.ts"), "utf8").replace("getUser", "get_user");
  writeFileSync(join(root, "src/users.ts"), users);
  await run(["check"]);
  await run(["fix", "--write"]);
  await run(["check"]);
  console.log(`\nDemo repository: ${root}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (process.env.DOCBIND_KEEP_DEMO !== "1") rmSync(root, { recursive: true, force: true });
}
