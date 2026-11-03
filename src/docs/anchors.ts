import type { DocAnchor } from "../types.js";

export function anchorKey(anchor: Pick<DocAnchor, "docPath" | "contextFp" | "token" | "occurrence">): string {
  return [anchor.docPath, anchor.contextFp, anchor.token, String(anchor.occurrence)].join("\u0000");
}

export function assignOccurrences(anchors: DocAnchor[]): DocAnchor[] {
  const counts = new Map<string, number>();
  const sorted = [...anchors].sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line;
    if (left.column !== right.column) return left.column - right.column;
    return left.token.localeCompare(right.token);
  });
  const seen = new Set<string>();
  const result: DocAnchor[] = [];
  for (const anchor of sorted) {
    const identity = `${anchor.docPath}|${anchor.line}|${anchor.column}|${anchor.surface}|${anchor.token}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const base = `${anchor.docPath}\u0000${anchor.contextFp}\u0000${anchor.token}`;
    const occurrence = counts.get(base) ?? 0;
    counts.set(base, occurrence + 1);
    result.push({ ...anchor, occurrence });
  }
  return result;
}
