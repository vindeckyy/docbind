import type { Finding } from "../types.js";

function escape(value: string): string {
  return value.replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

export function formatGithub(findings: Finding[]): string {
  return findings.map((finding) => {
    const level = finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "notice";
    const properties = [
      `file=${escape(finding.doc.path)}`,
      `line=${finding.doc.line}`,
      `col=${finding.doc.column}`,
      `title=${escape(`docbind ${finding.rule}`)}`,
    ].join(",");
    return `::${level} ${properties}::${escape(finding.message)}`;
  }).join("\n");
}
