import type { Shape, Symbol } from "../types.js";
import { jaccard, shapeTokens } from "../shape/canonical.js";
import { isKindCompatible } from "../shape/compat.js";

export interface RenameCandidate {
  symbol: Symbol;
  score: number;
  shapeSimilarity: number;
  bodySimilarity: number;
  nameSimilarity: number;
}

export interface RemovedSymbol {
  name: string;
  kind: Symbol["kind"];
  shapeText: string;
  bodyHash: string;
  modulePath: string;
}

export function parseShapeText(text: string): Shape {
  try {
    const parsed = JSON.parse(text) as Shape;
    return parsed && typeof parsed === "object" && parsed.kind ? parsed : { kind: "function" };
  } catch {
    return { kind: "function" };
  }
}

export function modulePathFromId(id: string): string {
  return id.split("|")[1] ?? "";
}

export function nameSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }
  const distance = matrix[a.length][b.length];
  return 1 - distance / Math.max(a.length, b.length, 1);
}

export function inferRename(removed: RemovedSymbol, symbols: Symbol[]): RenameCandidate | undefined {
  const oldTokens = shapeTokens(removed.shapeText);
  const candidates: RenameCandidate[] = [];
  for (const symbol of symbols) {
    if (!isKindCompatible(removed.kind, symbol.kind)) continue;
    const shapeSimilarity = jaccard(oldTokens, shapeTokens(symbol.shapeText));
    const bodySimilarity = removed.bodyHash === symbol.bodyHash && removed.bodyHash.length > 0 ? 1 : 0;
    const similarity = nameSimilarity(removed.name, symbol.name);
    const sameModule = removed.modulePath === symbol.modulePath ? 1 : 0;
    const score = 0.5 * shapeSimilarity + 0.25 * bodySimilarity + 0.15 * similarity + 0.1 * sameModule;
    candidates.push({ symbol, score, shapeSimilarity, bodySimilarity, nameSimilarity: similarity });
  }
  candidates.sort((left, right) => right.score - left.score || left.symbol.id.localeCompare(right.symbol.id));
  const best = candidates[0];
  if (!best) return undefined;
  if (best.shapeSimilarity < 0.95 || best.bodySimilarity < 0.6 || best.score < 0.8) return undefined;
  return best;
}
