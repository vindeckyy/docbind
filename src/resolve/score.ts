import type { DocAnchor, ResolveResult, Symbol } from "../types.js";

const PROSE_WORDS = new Set([
  "install", "usage", "example", "default", "optional", "required", "true", "false",
  "null", "none", "undefined", "error", "result", "data", "config", "value", "name",
  "string", "number", "boolean", "object", "array", "file", "path", "main", "test",
  "build", "start", "stop", "note", "warning", "deprecated", "since", "version",
]);

const KEYWORDS = new Set([
  "function", "class", "const", "let", "var", "return", "import", "export", "from",
  "interface", "type", "enum", "async", "await", "new", "this", "true", "false",
  "null", "undefined", "if", "else", "for", "while", "switch", "case", "break",
  "continue", "try", "catch", "finally", "throw", "extends", "implements", "public",
  "private", "protected", "static", "readonly", "void", "never", "unknown", "any",
  "def", "lambda", "pass", "raise", "with", "yield", "None", "True", "False",
]);

const URL_RE = /^(?:https?|ftp|ssh|git):\/\/|^git@|^mailto:/iu;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const SEMVER_RE = /^[~^]?v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const DURATION_RE = /^\d+(?:\.\d+)?(?:ms|s|m|h|d|kb|mb|gb|px|rem|em)$/iu;
const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/iu;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MIME_RE = /^(?:application|text|image|audio|video|multipart|font|model)\/[a-z0-9.+-]+$/iu;
const HTTP_RE = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//u;
const FLAG_RE = /^--?[A-Za-z]/u;
const PATH_RE = /^(?:\.{0,2}\/|~\/|\/)|\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|json|ya?ml|toml|md|txt|html|css)$/iu;

export interface TokenInfo {
  base: string;
  call: boolean;
  arity: number;
}

function countArity(value: string): number {
  const inner = value.trim();
  if (inner.length === 0) return 0;
  let depth = 0;
  let count = 1;
  for (const char of inner) {
    if (char === "<" || char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ">" || char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) count += 1;
  }
  return count;
}

export function parseToken(raw: string): TokenInfo {
  const token = raw.trim().replace(/^new\s+/u, "");
  const callMatch = /^([A-Za-z_$][\w$]*(?:(?:\.|::|#)[A-Za-z_$][\w$]*)*)\s*(?:<[^>]*>)?\s*\((.*)\)\s*$/su.exec(token);
  if (callMatch?.[1]) {
    return { base: callMatch[1], call: true, arity: countArity(callMatch[2] ?? "") };
  }
  return { base: token, call: token.includes("("), arity: 0 };
}

export function isApiDoc(docPath: string): boolean {
  return /(^|\/)(api|reference|usage|guide)(\/|\.|$)/iu.test(docPath);
}

export function vetoReason(token: string, anchor: DocAnchor): string | undefined {
  const info = parseToken(token);
  const base = info.base;
  if (base.length === 0) return "empty";
  if (HTTP_RE.test(base)) return "http";
  if (/\s/u.test(base)) return "whitespace";
  if (URL_RE.test(base)) return "url";
  if (EMAIL_RE.test(base)) return "email";
  if (SEMVER_RE.test(base)) return "semver";
  if (DATE_RE.test(base)) return "date";
  if (DURATION_RE.test(base)) return "duration";
  if (HEX_COLOR_RE.test(base)) return "hex color";
  if (UUID_RE.test(base)) return "uuid";
  if (MIME_RE.test(base) && !base.includes("::")) return "mime";
  if (FLAG_RE.test(base)) return "cli flag";
  if (PATH_RE.test(base)) return "path";
  if (/[*?[\]]/u.test(base) && !/[<>]/u.test(base)) return "glob or regex";
  if (KEYWORDS.has(base)) return "keyword";
  const imported = Object.keys(anchor.importTable).some((local) => base === local || base.startsWith(`${local}.`));
  if (PROSE_WORDS.has(base) && !imported && !isApiDoc(anchor.docPath)) return "prose word";
  return undefined;
}

export function normalizeModuleSource(source: string): string {
  return source
    .replace(/^\.\//u, "")
    .replace(/^\.\.\//u, "")
    .replace(/\.(?:d\.)?[cm]?[jt]sx?$/u, "")
    .replace(/\/index$/u, "")
    .replace(/^@[^/]+\//u, "");
}

export function moduleMatches(symbol: Symbol, source: string): boolean {
  const normalized = normalizeModuleSource(source);
  if (normalized.length === 0) return false;
  if (symbol.packageName === source) return true;
  return symbol.modulePath === normalized ||
    symbol.modulePath.endsWith(`/${normalized}`) ||
    symbol.modulePath.split("/").pop() === normalized;
}

export interface SymbolIndex {
  byId: Map<string, Symbol>;
  byName: Map<string, Symbol[]>;
  byQualified: Map<string, Symbol[]>;
}

export function buildIndex(symbols: Symbol[]): SymbolIndex {
  const byId = new Map<string, Symbol>();
  const byName = new Map<string, Symbol[]>();
  const byQualified = new Map<string, Symbol[]>();
  const pushUnique = (index: Map<string, Symbol[]>, key: string, symbol: Symbol): void => {
    const list = index.get(key) ?? [];
    if (!list.some((existing) => existing.id === symbol.id)) list.push(symbol);
    index.set(key, list);
  };
  for (const symbol of symbols) {
    byId.set(symbol.id, symbol);
    for (const name of new Set([symbol.name, ...symbol.aliases])) {
      const target = name.includes(".") || name.includes("::") || name.includes("#") ? byQualified : byName;
      pushUnique(target, name, symbol);
    }
    for (const qualified of new Set([symbol.qualifiedName, ...symbol.aliases])) {
      if (!qualified.includes(".") && !qualified.includes("::") && !qualified.includes("#")) continue;
      pushUnique(byQualified, qualified, symbol);
    }
  }
  return { byId, byName, byQualified };
}

function uniqueById(symbols: Symbol[]): Symbol[] {
  return [...new Map(symbols.map((symbol) => [symbol.id, symbol])).values()];
}

interface CandidateState {
  symbol: Symbol;
  score: number;
  evidence: string[];
}

export interface ScoreOptions {
  repeated?: boolean;
}

export function scoreCandidates(
  anchor: DocAnchor,
  index: SymbolIndex,
  options: ScoreOptions = {},
): ResolveResult {
  const info = parseToken(anchor.token);
  const base = info.base;
  const veto = vetoReason(anchor.token, anchor);
  if (veto) return { candidates: [], reason: "vetoed", veto };

  const candidates = new Map<string, CandidateState>();
  const add = (symbol: Symbol, delta: number, evidence: string): void => {
    const existing = candidates.get(symbol.id);
    if (existing) {
      existing.score += delta;
      existing.evidence.push(evidence);
      return;
    }
    candidates.set(symbol.id, { symbol, score: delta, evidence: [evidence] });
  };

  if (anchor.surface === "explicitRef") {
    const qualified = index.byQualified.get(base) ?? [];
    for (const symbol of uniqueById(qualified)) add(symbol, 0.95, "explicit reference");
    const named = index.byName.get(base) ?? [];
    for (const symbol of uniqueById(named)) add(symbol, 0.85, "explicit reference");
  }
  if (anchor.surface === "signatureFence") {
    const qualified = index.byQualified.get(base) ?? [];
    for (const symbol of uniqueById(qualified)) add(symbol, 0.55, "signature fence");
    const named = index.byName.get(base) ?? [];
    for (const symbol of uniqueById(named)) add(symbol, 0.5, "signature fence");
  }

  for (const [local, reference] of Object.entries(anchor.importTable)) {
    if (base === local && reference.imported !== "*") {
      for (const symbol of index.byName.get(reference.imported) ?? []) {
        if (moduleMatches(symbol, reference.source)) add(symbol, 0.55, "fence import");
      }
    }
    if (base.startsWith(`${local}.`)) {
      const remainder = base.slice(local.length + 1);
      const tail = remainder.split(/[.#]/u).pop() ?? remainder;
      for (const symbol of index.byName.get(tail) ?? []) {
        if (moduleMatches(symbol, reference.source)) add(symbol, 0.55, "fence import");
      }
    }
    if (reference.imported === "*" && base === local) {
      for (const symbol of index.byId.values()) {
        if (moduleMatches(symbol, reference.source) && !symbol.parentId) add(symbol, 0.1, "namespace import");
      }
    }
  }

  const qualifiedExact = index.byQualified.get(base) ?? [];
  for (const symbol of uniqueById(qualifiedExact)) add(symbol, 0.55, "qualified name");
  if (base.includes(".") || base.includes("::") || base.includes("#")) {
    const tail = base.split(/[.#]/u).pop() ?? base;
    for (const symbol of index.byName.get(tail) ?? []) {
      const forms = [symbol.qualifiedName, ...symbol.aliases];
      if (forms.some((form) => form === base || form.endsWith(`.${base}`) || form.endsWith(base))) {
        add(symbol, 0.4, "qualified suffix");
      }
    }
  }

  const named = uniqueById(index.byName.get(base) ?? []);
  for (const symbol of named) add(symbol, 0.35, "exported name");

  if (candidates.size === 1) {
    for (const candidate of candidates.values()) candidate.score += 0.15;
  }

  for (const candidate of candidates.values()) {
    const params = candidate.symbol.shape.params ?? [];
    const required = params.filter((param) => !param.optional && !param.rest && !param.hasDefault).length;
    const arityMatches = info.call &&
      (params.some((param) => param.rest) || (info.arity >= required && info.arity <= params.length));
    if (arityMatches) {
      candidate.score += 0.2;
      candidate.evidence.push("call arity");
    }
    if (isApiDoc(anchor.docPath)) {
      candidate.score += 0.1;
      candidate.evidence.push("api doc");
    }
    if (options.repeated) {
      candidate.score += 0.1;
      candidate.evidence.push("repeated mention");
    }
    if (anchor.localDecls.includes(base)) {
      candidate.score -= 0.6;
      candidate.evidence.push("shadowed");
    }
    if (anchor.fragment) candidate.score -= 0.2;
    if (base.length <= 2) candidate.score -= 0.2;
  }

  const scored = [...candidates.values()]
    .map((candidate) => ({
      symbol: candidate.symbol,
      score: Math.max(0, Math.min(1, candidate.score)),
      evidence: candidate.evidence,
    }))
    .sort((left, right) => right.score - left.score || left.symbol.id.localeCompare(right.symbol.id));

  if (scored.length === 0) return { candidates: [], reason: "unbound" };
  const best = scored[0];
  const second = scored[1];
  if (best.score < 0.7) return { candidates: scored, reason: "unbound" };
  if (second && best.score - second.score <= 0.05) {
    return { candidates: scored, reason: "ambiguous" };
  }
  return {
    candidates: scored,
    reason: "bound",
    binding: { anchor, symbol: best.symbol, score: best.score, evidence: best.evidence },
  };
}
