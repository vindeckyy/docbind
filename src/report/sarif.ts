import { RULES, type Finding } from "../types.js";
import { ENGINE_NAME } from "../version.js";

const LEVELS: Record<Finding["severity"], "error" | "warning" | "note"> = {
  error: "error",
  warning: "warning",
  note: "note",
};

export function formatSarif(findings: Finding[]): string {
  const rules = RULES.map((rule) => ({
    id: rule,
    name: rule,
    shortDescription: { text: rule },
  }));
  const results = findings.map((finding) => ({
    ruleId: finding.rule,
    level: LEVELS[finding.severity],
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.doc.path },
          region: {
            startLine: finding.doc.line,
            startColumn: finding.doc.column,
            endColumn: finding.doc.column + finding.doc.length,
          },
        },
      },
    ],
    ...(finding.code
      ? {
          relatedLocations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.code.path },
                region: { startLine: finding.code.line },
              },
            },
          ],
        }
      : {}),
    partialFingerprints: { docbindFinding: finding.id },
  }));
  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: { driver: { name: ENGINE_NAME, informationUri: "https://github.com/docbind/docbind", rules } },
          results,
        },
      ],
    },
    null,
    2,
  );
}
