import type { DocAnchor, Tombstone } from "../types.js";
import { parseToken } from "./score.js";

export function matchTombstone(anchor: DocAnchor, tombstones: Tombstone[]): Tombstone | undefined {
  const base = parseToken(anchor.token).base;
  const matches = tombstones.filter((tombstone) => {
    if (tombstone.name === base) return true;
    if (tombstone.qualifiedName === base) return true;
    return tombstone.qualifiedName.endsWith(`.${base}`) || tombstone.qualifiedName.endsWith(base);
  });
  const unique = new Map(matches.map((tombstone) => [tombstone.symbolId, tombstone]));
  return unique.size === 1 ? [...unique.values()][0] : undefined;
}
