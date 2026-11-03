import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./types.js";

export interface FixResult {
  changedFiles: string[];
  skipped: Array<{ finding: Finding; reason: string }>;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

export function applyFixes(root: string, findings: Finding[]): FixResult {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (!finding.fix) continue;
    const list = byFile.get(finding.doc.path) ?? [];
    list.push(finding);
    byFile.set(finding.doc.path, list);
  }

  const changedFiles: string[] = [];
  const skipped: Array<{ finding: Finding; reason: string }> = [];
  for (const [docPath, fileFindings] of byFile) {
    const path = join(root, docPath);
    const text = readFileSync(path, "utf8");
    const starts = lineStarts(text);
    const edits: Array<{ start: number; end: number; replacement: string; finding: Finding }> = [];
    for (const finding of fileFindings) {
      const lineStart = starts[finding.doc.line - 1];
      if (lineStart === undefined) {
        skipped.push({ finding, reason: "line out of range" });
        continue;
      }
      const start = lineStart + finding.doc.column - 1;
      const end = start + finding.doc.length;
      const span = text.slice(start, end);
      const from = finding.fix?.from ?? finding.doc.path;
      const first = span.indexOf(from);
      if (first < 0 || span.indexOf(from, first + 1) >= 0) {
        skipped.push({ finding, reason: "token not found exactly once in span" });
        continue;
      }
      edits.push({
        start: start + first,
        end: start + first + from.length,
        replacement: finding.fix?.to ?? from,
        finding,
      });
    }
    if (edits.length === 0) continue;
    edits.sort((left, right) => right.start - left.start);
    let updated = text;
    for (const edit of edits) {
      updated = `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`;
    }
    writeFileSync(path, updated, "utf8");
    changedFiles.push(docPath);
  }
  return { changedFiles: changedFiles.sort(), skipped };
}
