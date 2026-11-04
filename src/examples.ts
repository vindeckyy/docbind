import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverDocs } from "./discover.js";
import type { Config } from "./types.js";

export interface ExampleAudit {
  fences: number;
  docsWithExamples: string[];
  configuredDocs: string[];
  unconfiguredDocs: string[];
}

export function auditExamples(root: string, config: Config): ExampleAudit {
  const configured = new Set(config.doctests.flatMap((entry) => entry.docs ?? []));
  const docsWithExamples: string[] = [];
  let fences = 0;
  for (const docPath of discoverDocs(root, config)) {
    let text: string;
    try {
      text = readFileSync(join(root, docPath), "utf8");
    } catch {
      continue;
    }
    const count = (text.match(/^\s*(?:```|~~~)/gmu) ?? []).length;
    const blocks = Math.floor(count / 2);
    if (blocks === 0) continue;
    fences += blocks;
    docsWithExamples.push(docPath);
  }
  return {
    fences,
    docsWithExamples,
    configuredDocs: docsWithExamples.filter((doc) => configured.has(doc)),
    unconfiguredDocs: docsWithExamples.filter((doc) => !configured.has(doc)),
  };
}
