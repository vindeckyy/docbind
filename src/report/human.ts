import pc from "picocolors";
import type { CheckResult, Finding } from "../types.js";

export interface HumanOptions {
  color?: boolean;
  all?: boolean;
}

export function formatHuman(result: CheckResult, options: HumanOptions = {}): string {
  const enabled = options.color ?? true;
  const paint = (value: string, color: (input: string) => string): string => enabled ? color(value) : value;
  const lines: string[] = [];
  for (const finding of result.findings) {
    if (!options.all && finding.severity === "note") continue;
    const label = finding.severity === "error"
      ? paint("error", pc.red)
      : finding.severity === "warning"
        ? paint("warning", pc.yellow)
        : paint("note", pc.blue);
    lines.push(
      `${pc.cyan(`${finding.doc.path}:${finding.doc.line}`)}  ${label}  ${pc.dim(finding.rule)}  ${finding.message}`,
    );
    if (finding.code) {
      lines.push(`  code: ${finding.code.path}:${finding.code.line}`);
    }
    if (finding.fix) {
      lines.push(`  fix:  docbind fix --write`);
    }
  }
  const errors = result.findings.filter((finding) => finding.severity === "error").length;
  const warnings = result.findings.filter((finding) => finding.severity === "warning").length;
  lines.push(
    `${result.stats.docsScanned} docs, ${result.stats.codeFilesScanned} code files, ${result.stats.symbols} symbols, ${result.stats.anchors} anchors, ${result.stats.bound} bound`,
  );
  lines.push(`${errors} errors, ${warnings} warnings, ${result.findings.length} total`);
  return lines.join("\n");
}

export function formatFindingsJson(findings: Finding[], result: CheckResult): string {
  return JSON.stringify({ findings, stats: result.stats }, null, 2);
}
