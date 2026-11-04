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

export function changedLines(root: string, base: string): Map<string, Set<number>> {
  const lines = new Map<string, Set<number>>();
  const commands = [
    ["diff", "-U0", "--diff-filter=ACMR", `${base}...HEAD`],
    ["diff", "-U0", "--diff-filter=ACMR"],
  ];
  for (const args of commands) {
    try {
      const output = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      let current = "";
      for (const line of output.split(/\r?\n/u)) {
        if (line.startsWith("+++ b/")) {
          current = line.slice(6).trim();
          if (!lines.has(current)) lines.set(current, new Set());
          continue;
        }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
        if (!hunk || !current) continue;
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        for (let offset = 0; offset < count; offset += 1) {
          (lines.get(current) as Set<number>).add(start + offset);
        }
      }
    } catch {
      // Try the next diff form.
    }
  }
  return lines;
}
