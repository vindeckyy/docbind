import { hashText } from "./hash.js";
import type { Config, DocAnchor, Finding, Rule, Severity, Symbol } from "./types.js";

export interface FindingInput {
  rule: Rule;
  anchor: DocAnchor;
  symbol?: Symbol;
  message: string;
  suggestion?: string;
  fix?: Finding["fix"];
}

export function severityFor(rule: Rule, config: Config): Severity {
  return config.severity[rule];
}

export function makeFinding(input: FindingInput, config: Config): Finding | undefined {
  const severity = severityFor(input.rule, config);
  if (severity === "off") return undefined;
  const symbolId = input.symbol?.id ?? "";
  const { anchor } = input;
  return {
    id: hashText(`${anchor.docPath}\0${anchor.token}\0${symbolId}\0${input.rule}`, 12),
    rule: input.rule,
    severity,
    doc: {
      path: anchor.docPath,
      line: anchor.line,
      column: anchor.column,
      length: anchor.length,
    },
    ...(input.symbol
      ? { code: { path: input.symbol.filePath, line: input.symbol.line, symbolId: input.symbol.id } }
      : {}),
    message: input.message,
    ...(input.suggestion ? { suggestion: input.suggestion } : {}),
    ...(input.fix ? { fix: input.fix } : {}),
  };
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()];
}
