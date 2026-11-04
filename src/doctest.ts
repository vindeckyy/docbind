import { spawnSync } from "node:child_process";
import { hashText } from "./hash.js";
import type { Config, DoctestCommand, Finding } from "./types.js";

function firstLine(text: string): string {
  return text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
}

export function runDoctests(root: string, config: Config): Finding[] {
  const findings: Finding[] = [];
  for (const entry of config.doctests) {
    const result = spawnSync(entry.command, entry.args, {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status === 0) continue;
    if (config.severity["D1-doctest"] === "off") continue;
    const docPath = entry.docs?.[0] ?? "README.md";
    const reason = result.error ? result.error.message : firstLine(result.stderr || result.stdout);
    const message = `${entry.name} failed (exit ${result.status ?? "error"})${reason ? `: ${reason}` : ""}`;
    findings.push({
      id: hashText(`${entry.name}\0${docPath}\0D1-doctest`, 12),
      rule: "D1-doctest",
      severity: config.severity["D1-doctest"],
      doc: { path: docPath, line: 1, column: 1, length: 1 },
      message,
    });
  }
  return findings;
}

export function doctestCommands(config: Config): DoctestCommand[] {
  return config.doctests;
}
