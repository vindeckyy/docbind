import { parseDocs } from "./docs/parse.js";
import { discoverCode, discoverDocs } from "./discover.js";
import { buildIndex, resolveAnchor } from "./resolve/resolve.js";
import { parseToken } from "./resolve/score.js";
import { extractSurface } from "./surface/index.js";
import { readLock } from "./lock/schema.js";
import { anchorKey } from "./docs/anchors.js";
import type { Config } from "./types.js";

export interface ExplainTarget {
  docPath: string;
  line: number;
  column?: number;
}

export function explain(root: string, config: Config, target: ExplainTarget): string {
  const docs = discoverDocs(root, config);
  const doc = docs.find((candidate) => candidate === target.docPath);
  if (!doc) return `${target.docPath}: not found in configured docs`;
  const parsed = parseDocs(root, [doc]);
  const anchors = parsed.anchors.filter((anchor) =>
    anchor.line === target.line &&
    (target.column === undefined || anchor.column === target.column)
  );
  if (anchors.length === 0) {
    return `${target.docPath}:${target.line}: no bindable anchor`;
  }
  const anchor = anchors[0];
  const surface = extractSurface(root, discoverCode(root, config), config);
  const index = buildIndex(surface.symbols);
  const base = parseToken(anchor.token).base;
  const repeated = parsed.anchors.filter((candidate) => parseToken(candidate.token).base === base).length > 1;
  const resolved = resolveAnchor(anchor, index, { repeated });
  const lock = readLock(root);
  const locked = lock.anchors.find((entry) => anchorKey(entry) === anchorKey(anchor));
  const lines = [
    `${anchor.docPath}:${anchor.line}:${anchor.column} token=${JSON.stringify(anchor.token)} surface=${anchor.surface}`,
    `context=${anchor.contextFp}`,
  ];
  if (resolved.veto) lines.push(`vetoed: ${resolved.veto}`);
  if (resolved.reason === "ambiguous") lines.push("ambiguous: candidates tie");
  if (resolved.binding) {
    lines.push(`bound: ${resolved.binding.symbol.id} score=${resolved.binding.score.toFixed(2)}`);
    lines.push(`evidence: ${resolved.binding.evidence.join(", ")}`);
  } else {
    lines.push(`unbound (${resolved.reason})`);
  }
  if (locked) {
    lines.push(`lock: ${locked.symbolId} shape=${locked.shapeHash}`);
  } else {
    lines.push("lock: no entry");
  }
  for (const candidate of resolved.candidates.slice(0, 8)) {
    lines.push(`candidate ${candidate.score.toFixed(2)} ${candidate.symbol.id} [${candidate.evidence.join(", ")}]`);
  }
  return lines.join("\n");
}
