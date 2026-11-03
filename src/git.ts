import { execFileSync } from "node:child_process";

export function changedFiles(root: string, base: string): Set<string> {
  const files = new Set<string>();
  const commands = [
    ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
    ["diff", "--name-only", "--diff-filter=ACMR"],
  ];
  for (const args of commands) {
    try {
      const output = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of output.split(/\r?\n/u)) {
        if (line.trim()) files.add(line.trim());
      }
    } catch {
      return files;
    }
  }
  return files;
}
