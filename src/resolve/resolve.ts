import type { DocAnchor, ResolveResult } from "../types.js";
import { scoreCandidates, type ScoreOptions, type SymbolIndex } from "./score.js";

export function resolveAnchor(
  anchor: DocAnchor,
  index: SymbolIndex,
  options: ScoreOptions = {},
): ResolveResult {
  return scoreCandidates(anchor, index, options);
}

export { buildIndex, moduleMatches } from "./score.js";
