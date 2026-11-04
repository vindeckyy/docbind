import { spawnSync } from "node:child_process";
import { hashText } from "./hash.js";
import type { Config, Finding, ProbeCommand } from "./types.js";

export interface ProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export type ProbeRunner = (root: string, probe: ProbeCommand) => ProbeResult;

export function dockerArgs(root: string, probe: ProbeCommand): string[] {
  return [
    "run", "--rm",
    "--network", "none",
    "--read-only",
    "--tmpfs", "/tmp",
    "--memory", "256m",
    "--cpus", "1",
    "--user", "65534:65534",
    "-v", `${root}:/workspace:ro`,
    "-w", "/workspace",
    probe.image,
    probe.command,
    ...probe.args,
  ];
}

export const dockerProbe: ProbeRunner = (root, probe) => {
  const result = spawnSync("docker", dockerArgs(root, probe), {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error.message } : {}),
  };
};

function firstLine(text: string): string {
  return text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
}

export function runProbes(root: string, config: Config, runner: ProbeRunner = dockerProbe): Finding[] {
  const findings: Finding[] = [];
  for (const probe of config.probes) {
    const result = runner(root, probe);
    if (result.status === 0) continue;
    if (config.severity["D2-probe"] === "off") continue;
    const docPath = probe.docs?.[0] ?? "README.md";
    const reason = result.error ?? firstLine(result.stderr || result.stdout);
    findings.push({
      id: hashText(`${probe.name}\0${docPath}\0D2-probe`, 12),
      rule: "D2-probe",
      severity: config.severity["D2-probe"],
      doc: { path: docPath, line: 1, column: 1, length: 1 },
      message: `${probe.name} probe failed (exit ${result.status ?? "error"})${reason ? `: ${reason}` : ""}`,
    });
  }
  return findings;
}
