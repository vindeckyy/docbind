import { buildIndex, resolveAnchor } from "./resolve/resolve.js";
import { matchTombstone } from "./resolve/tombstone.js";
import { inferRename, modulePathFromId, parseShapeText } from "./resolve/rename.js";
import { parseDocs } from "./docs/parse.js";
import { anchorKey } from "./docs/anchors.js";
import { compareShapeClaims } from "./shape/compat.js";
import { dedupeFindings, makeFinding } from "./findings.js";
import { mergeEntries, mergeTombstones } from "./lock/merge.js";
import { readLock } from "./lock/schema.js";
import { discoverCode, discoverDocs } from "./discover.js";
import { extractSurface } from "./surface/index.js";
import { parseToken } from "./resolve/score.js";
import type {
  Binding,
  CheckResult,
  Config,
  DocAnchor,
  Finding,
  LockEntry,
  LockFile,
  Symbol,
  Tombstone,
} from "./types.js";

function tombstoneFromEntry(entry: LockEntry, generation: number, renamedTo?: string): Tombstone {
  return {
    symbolId: entry.symbolId,
    name: entry.name,
    qualifiedName: entry.qualifiedName,
    kind: entry.kind,
    shapeHash: entry.shapeHash,
    shape: entry.shape,
    bodyHash: entry.bodyHash,
    removedInGeneration: generation,
    ...(renamedTo ? { renamedTo } : {}),
  };
}

function renderedForms(symbol: Symbol): string[] {
  return [symbol.qualifiedName, ...symbol.aliases, symbol.name];
}

function preferredPath(symbol: Symbol): string {
  const forms = renderedForms(symbol)
    .filter((form) => form.endsWith(`.${symbol.name}`))
    .sort((left, right) => left.length - right.length);
  return forms[0] ?? symbol.qualifiedName;
}

function movedFinding(entry: LockEntry, anchor: DocAnchor, symbol: Symbol, config: Config): Finding | undefined {
  const base = parseToken(anchor.token).base;
  if (!/[.#]|::/u.test(base)) return undefined;
  const normalized = base.replace(/::/gu, ".");
  const forms = renderedForms(symbol).map((form) => form.replace(/::/gu, "."));
  if (forms.some((form) => form === normalized || form.endsWith(`.${normalized}`) || form.endsWith(normalized))) {
    return undefined;
  }
  const target = base.includes("::")
    ? preferredPath(symbol).replace(/\./gu, "::")
    : preferredPath(symbol);
  return makeFinding(
    {
      rule: "L2-moved",
      anchor,
      symbol,
      message: `${anchor.token} moved to ${target}`,
      fix: { kind: "replacePath", from: base, to: target },
    },
    config,
  );
}

function reshapedFinding(
  entry: LockEntry,
  anchor: DocAnchor,
  symbol: Symbol,
  config: Config,
): Finding | undefined {
  const oldShape = parseShapeText(entry.shape);
  const delta = compareShapeClaims(oldShape, symbol.shape);
  const changes = [...delta.changes];
  const oldParamCount = (oldShape.params ?? []).length;
  const newParamCount = (symbol.shape.params ?? []).length;
  if (
    parseToken(anchor.token).call &&
    oldParamCount === newParamCount &&
    entry.paramNamesHash !== symbol.paramNamesHash
  ) {
    changes.push("parameter names changed");
  }
  if (!delta.breaking && !changes.includes("parameter names changed")) return undefined;
  return makeFinding(
    {
      rule: "L3-reshaped",
      anchor,
      symbol,
      message: changes.length > 0
        ? `${anchor.token} contract changed: ${changes.join("; ")}`
        : `${anchor.token} contract changed`,
      suggestion: `old: ${entry.shape}\nnew: ${symbol.shapeText}`,
    },
    config,
  );
}

function signatureFinding(anchor: DocAnchor, symbol: Symbol, config: Config): Finding | undefined {
  if (!anchor.signatureShape) return undefined;
  const delta = compareShapeClaims(anchor.signatureShape, symbol.shape);
  if (!delta.breaking) return undefined;
  return makeFinding(
    {
      rule: "L3-reshaped",
      anchor,
      symbol,
      message: `${anchor.token} signature no longer matches: ${delta.changes.join("; ")}`,
    },
    config,
  );
}

function deprecatedFinding(entry: LockEntry, anchor: DocAnchor, symbol: Symbol, config: Config): Finding | undefined {
  if (!symbol.contractFlags.includes("deprecated")) return undefined;
  const oldShape = parseShapeText(entry.shape);
  if ((oldShape.flags ?? []).includes("deprecated")) return undefined;
  return makeFinding(
    {
      rule: "S1-deprecated",
      anchor,
      symbol,
      message: `${symbol.name} is deprecated in code but the doc does not say so`,
    },
    config,
  );
}

function renameFinding(
  entry: LockEntry,
  anchor: DocAnchor,
  symbols: Symbol[],
  config: Config,
): { finding?: Finding; renamedTo?: Symbol } {
  const candidate = inferRename(
    {
      name: entry.name,
      kind: entry.kind,
      shapeText: entry.shape,
      bodyHash: entry.bodyHash,
      modulePath: modulePathFromId(entry.symbolId),
    },
    symbols,
  );
  if (!candidate) return {};
  const base = parseToken(anchor.token).base;
  if (candidate.symbol.name === entry.name) {
    if (!/[.#]|::/u.test(base)) return {};
    const moved = makeFinding(
      {
        rule: "L2-moved",
        anchor,
        symbol: candidate.symbol,
        message: `${entry.name} moved to ${preferredPath(candidate.symbol)}`,
        fix: { kind: "replacePath", from: base, to: preferredPath(candidate.symbol) },
      },
      config,
    );
    return { finding: moved, renamedTo: candidate.symbol };
  }
  const target = /[.#]|::/u.test(base) ? candidate.symbol.qualifiedName : candidate.symbol.name;
  const finding = makeFinding(
    {
      rule: "L4-renamed",
      anchor,
      symbol: candidate.symbol,
      message: `${entry.name} was renamed to ${candidate.symbol.name}`,
      fix: { kind: "replaceToken", from: base, to: target },
    },
    config,
  );
  return { finding, renamedTo: candidate.symbol };
}

function repeatedTokens(anchors: DocAnchor[]): Set<string> {
  const counts = new Map<string, number>();
  for (const anchor of anchors) {
    const base = parseToken(anchor.token).base;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([token]) => token));
}

export interface CheckProjectOptions {
  ignoreBaseline?: boolean;
}

export function checkProject(root: string, config: Config, options: CheckProjectOptions = {}): CheckResult {
  const docs = discoverDocs(root, config);
  const codeFiles = discoverCode(root, config);
  const parsedDocs = parseDocs(root, docs);
  const surface = extractSurface(root, codeFiles, config);
  const loadedLock = readLock(root);
  const lock = options.ignoreBaseline ? { ...loadedLock, anchors: [] } : loadedLock;
  const index = buildIndex(surface.symbols);
  const anchors = parsedDocs.anchors;
  const byKey = new Map(anchors.map((anchor) => [anchorKey(anchor), anchor]));
  const repeated = repeatedTokens(anchors);
  const findings: Finding[] = [];
  const pending: Binding[] = [];
  const retained: LockEntry[] = [];
  const freshTombstones: Tombstone[] = [];
  const referenced = new Set<string>();
  const seenEntries = new Set<string>();
  const exactKeys = new Set(lock.anchors.map((entry) => anchorKey(entry)));

  for (const entry of lock.anchors) {
    const key = anchorKey(entry);
    if (seenEntries.has(key)) continue;
    seenEntries.add(key);
    let anchor = byKey.get(key);
    let matchedKey = key;
    if (!anchor) {
      for (const [candidateKey, candidate] of byKey) {
        if (exactKeys.has(candidateKey)) continue;
        if (candidate.docPath === entry.docPath && candidate.token === entry.token) {
          anchor = candidate;
          matchedKey = candidateKey;
          break;
        }
      }
    }
    if (!anchor) continue;
    byKey.delete(matchedKey);
    const symbol = index.byId.get(entry.symbolId);
    if (!symbol) {
      const rename = renameFinding(entry, anchor, surface.symbols, config);
      if (rename.finding) findings.push(rename.finding);
      if (!rename.finding) {
        const finding = makeFinding(
          {
            rule: "L1-broken",
            anchor,
            message: `${entry.name} no longer exists`,
          },
          config,
        );
        if (finding) findings.push(finding);
      }
      freshTombstones.push(tombstoneFromEntry(entry, lock.generation, rename.renamedTo?.id));
      continue;
    }

    referenced.add(symbol.id);
    retained.push({
      ...entry,
      contextFp: anchor.contextFp,
      occurrence: anchor.occurrence,
      token: anchor.token,
    });
    const moved = movedFinding(entry, anchor, symbol, config);
    if (moved) findings.push(moved);
    const reshaped = reshapedFinding(entry, anchor, symbol, config);
    if (reshaped) findings.push(reshaped);
    const signature = signatureFinding(anchor, symbol, config);
    if (signature) findings.push(signature);
    const deprecated = deprecatedFinding(entry, anchor, symbol, config);
    if (deprecated) findings.push(deprecated);
  }

  for (const anchor of byKey.values()) {
    const base = parseToken(anchor.token).base;
    if (anchor.surface === "explicitRef") {
      const resolved = resolveAnchor(anchor, index, { repeated: repeated.has(base) });
      if (resolved.binding) {
        pending.push(resolved.binding);
        referenced.add(resolved.binding.symbol.id);
      } else {
        const finding = makeFinding(
          {
            rule: "L1-broken",
            anchor,
            message: `${anchor.token} does not resolve to an exported symbol`,
          },
          config,
        );
        if (finding) findings.push(finding);
      }
      continue;
    }

    const tombstone = matchTombstone(anchor, lock.tombstones);
    if (tombstone) {
      const target = tombstone.renamedTo ? index.byId.get(tombstone.renamedTo) : undefined;
      if (target) {
        const sameName = target.name === tombstone.name;
        const finding = makeFinding(
          {
            rule: sameName ? "L2-moved" : "L4-renamed",
            anchor,
            symbol: target,
            message: sameName
              ? `${tombstone.name} moved to ${preferredPath(target)}`
              : `${tombstone.name} was renamed to ${target.name}`,
            fix: {
              kind: sameName ? "replacePath" : "replaceToken",
              from: base,
              to: sameName
                ? preferredPath(target)
                : /[.#]|::/u.test(base) ? target.qualifiedName : target.name,
            },
          },
          config,
        );
        if (finding) findings.push(finding);
      } else {
        const finding = makeFinding(
          {
            rule: "L1-broken",
            anchor,
            message: `${tombstone.name} no longer exists`,
          },
          config,
        );
        if (finding) findings.push(finding);
      }
      continue;
    }

    const resolved = resolveAnchor(anchor, index, { repeated: repeated.has(base) });
    if (!resolved.binding) continue;
    if (anchor.surface === "signatureFence") {
      const signature = signatureFinding(anchor, resolved.binding.symbol, config);
      if (signature) {
        findings.push(signature);
        continue;
      }
    }
    pending.push(resolved.binding);
    referenced.add(resolved.binding.symbol.id);
  }

  const nextLock: LockFile = {
    ...lock,
    anchors: mergeEntries(retained, pending),
    tombstones: mergeTombstones(lock.tombstones, freshTombstones, referenced, lock.generation),
  };

  return {
    findings: dedupeFindings(findings).sort((left, right) => {
      if (left.doc.path !== right.doc.path) return left.doc.path.localeCompare(right.doc.path);
      return left.doc.line - right.doc.line;
    }),
    pending,
    stats: {
      docsScanned: parsedDocs.docsScanned,
      codeFilesScanned: surface.filesScanned,
      symbols: surface.symbols.length,
      anchors: anchors.length,
      bound: retained.length + pending.length,
      unbound: Math.max(0, anchors.length - retained.length - pending.length),
      parseFailures: parsedDocs.parseFailures + surface.parseFailures,
    },
    lock: nextLock,
  };
}

export function markLockAdvanced(lock: LockFile): LockFile {
  return { ...lock, generation: lock.generation + 1 };
}
