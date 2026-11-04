import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { checkProject } from "./check.js";
import type { Config } from "./types.js";

export interface Adoption {
  docPath: string;
  line: number;
  column: number;
  token: string;
  symbolId: string;
  annotation: string;
}

export function suggestAnnotations(root: string, config: Config): Adoption[] {
  const result = checkProject(root, config);
  const explicit = new Set(
    result.pending
      .filter((binding) => binding.anchor.explicitSymbol)
      .map((binding) => `${binding.anchor.docPath}\u0000${binding.symbol.filePath}#${binding.symbol.name}`),
  );
  const seen = new Set<string>();
  const suggestions: Adoption[] = [];
  for (const binding of result.pending) {
    const anchor = binding.anchor;
    if (anchor.explicitSymbol) continue;
    const annotation = `<!-- docbind: symbol=${binding.symbol.filePath}#${binding.symbol.name} -->`;
    if (explicit.has(`${anchor.docPath}\u0000${binding.symbol.filePath}#${binding.symbol.name}`)) continue;
    const key = `${anchor.docPath}\u0000${anchor.line}\u0000${annotation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      docPath: anchor.docPath,
      line: anchor.line,
      column: anchor.column,
      token: anchor.token,
      symbolId: binding.symbol.id,
      annotation,
    });
  }
  return suggestions.sort((left, right) => {
    if (left.docPath !== right.docPath) return left.docPath.localeCompare(right.docPath);
    return left.line - right.line;
  });
}

export function applyAnnotations(root: string, adoptions: Adoption[]): { changedFiles: string[]; inserted: number } {
  const byFile = new Map<string, Adoption[]>();
  for (const adoption of adoptions) {
    const list = byFile.get(adoption.docPath) ?? [];
    list.push(adoption);
    byFile.set(adoption.docPath, list);
  }
  const changedFiles: string[] = [];
  let inserted = 0;
  for (const [docPath, list] of byFile) {
    const path = join(root, docPath);
    const original = readFileSync(path, "utf8");
    const lines = original.split(/\r?\n/u);
    const byLine = new Map<number, string[]>();
    for (const adoption of list) {
      const annotations = byLine.get(adoption.line) ?? [];
      if (!annotations.includes(adoption.annotation)) annotations.push(adoption.annotation);
      byLine.set(adoption.line, annotations);
    }
    for (const line of [...byLine.keys()].sort((left, right) => right - left)) {
      const index = line - 1;
      if (index < 0 || index >= lines.length) continue;
      const target = lines[index] ?? "";
      const indent = target.match(/^\s*/u)?.[0] ?? "";
      const annotations = (byLine.get(line) ?? []).filter(
        (annotation) => !(lines[index - 1] ?? "").includes(annotation),
      );
      if (annotations.length === 0) continue;
      lines.splice(index, 0, ...annotations.map((annotation) => `${indent}${annotation}`));
      inserted += annotations.length;
    }
    writeFileSync(path, lines.join("\n"));
    changedFiles.push(relative(root, path).replace(/\\/gu, "/"));
  }
  return { changedFiles, inserted };
}
