import type { ParamShape, Shape, SymbolKind } from "../types.js";

const TYPE_WORDS = new Set([
  "int", "integer", "string", "str", "bool", "boolean", "void", "long", "double",
  "float", "char", "byte", "short", "object", "any", "number", "bytes", "error",
  "uint", "uint32", "uint64", "int32", "int64", "float32", "float64", "unsigned",
  "signed", "struct", "enum", "union", "size_t", "ssize_t", "auto", "const",
  "volatile", "final", "var", "let",
]);

const MODIFIERS = new Set([
  "export", "default", "public", "private", "protected", "static", "abstract",
  "async", "final", "readonly", "function", "func", "fn", "def", "fun", "pub",
  "unsafe", "extern", "inline", "constexpr", "virtual", "override", "operator",
]);

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if ("([{<".includes(character)) depth += 1;
    if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
    if (character === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function colonAtTopLevel(value: string): number {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string;
    if ("([{<".includes(character)) depth += 1;
    if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
    if (character === ":" && depth === 0) return index;
  }
  return -1;
}

function cleanType(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/\s+([*&]+)/gu, " $1")
    .replace(/^[*&]\s*/u, "")
    .trim();
}

function parseFunctionPointer(value: string): ParamShape | undefined {
  const match = value.match(/^(.*?)\(\s*\*\s*([A-Za-z_$][\w$]*)\s*\)\s*(\([^)]*\))$/u);
  if (!match) return undefined;
  return {
    name: match[2],
    type: cleanType(`${match[1]}(*)${match[3]}`),
    optional: false,
    rest: false,
    hasDefault: false,
    kind: "positional",
  };
}

function parseParam(raw: string): ParamShape | undefined {
  let value = raw.trim().replace(/,$/u, "");
  if (!value || ["self", "&self", "&mut self", "this", "*", "/"].includes(value)) return undefined;
  const rest = value.startsWith("...") || value.startsWith("*");
  value = value.replace(/^\.{3}/u, "").replace(/^\*{1,2}/u, "").trim();
  const hasDefault = value.includes("=");
  value = value.split("=")[0]?.trim() ?? value;
  const optional = value.includes("?");
  value = value.replace(/\?/u, "").trim();
  value = value.replace(/^@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s*/u, "");

  const pointer = parseFunctionPointer(value);
  if (pointer) return { ...pointer, rest };

  const colon = colonAtTopLevel(value);
  if (colon >= 0) {
    const name = value.slice(0, colon).trim();
    const type = cleanType(value.slice(colon + 1));
    return {
      ...(name && !name.startsWith("{") ? { name } : {}),
      type,
      optional,
      rest,
      hasDefault,
      kind: "positional",
    };
  }

  const tokens = value.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return undefined;
  if (tokens.length === 1) {
    return { type: cleanType(tokens[0] as string), optional, rest, hasDefault, kind: "positional" };
  }
  let last = tokens[tokens.length - 1] as string;
  let before = tokens.slice(0, -1);
  const first = tokens[0] as string;
  const pointerName = last.match(/^([*&]+)([A-Za-z_$][\w$]*)(\[\])?$/u);
  if (pointerName?.[2] && before.some((token) => TYPE_WORDS.has(token) || /^[A-Z]/u.test(token))) {
    const suffix = `${pointerName[1]}${pointerName[3] ?? ""}`;
    return {
      name: pointerName[2],
      type: cleanType(`${before.join(" ")} ${suffix}`),
      optional,
      rest,
      hasDefault,
      kind: "positional",
    };
  }
  const arrayName = last.match(/^([A-Za-z_$][\w$]*)(\[\])$/u);
  if (arrayName?.[1]) {
    return {
      name: arrayName[1],
      type: cleanType(`${before.join(" ")}[]`),
      optional,
      rest,
      hasDefault,
      kind: "positional",
    };
  }
  const typeFirst =
    TYPE_WORDS.has(first) ||
    /^[A-Z]/u.test(first) ||
    before.some(
      (token) => token.endsWith("*") || token.endsWith("&") || TYPE_WORDS.has(token) ||
        token.includes("<") || token.includes(">"),
    );
  if (/^[A-Za-z_$][\w$]*$/u.test(last) && (typeFirst || /^[A-Z]/u.test(last))) {
    return {
      name: last,
      type: cleanType(before.join(" ")),
      optional,
      rest,
      hasDefault,
      kind: "positional",
    };
  }
  const name = first.replace(/\[\]$/u, "");
  const type = cleanType(tokens.slice(1).join(" "));
  if (!type) {
    return { type: cleanType(value), optional, rest, hasDefault, kind: "positional" };
  }
  return {
    ...(/^[A-Za-z_$][\w$]*$/u.test(name) ? { name } : {}),
    type,
    optional,
    rest,
    hasDefault,
    kind: "positional",
  };
}

function stripLeadingAngle(value: string): string {
  if (!value.startsWith("<")) return value;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "<") depth += 1;
    if (value[index] === ">") {
      depth -= 1;
      if (depth === 0) return value.slice(index + 1).trim();
    }
  }
  return value;
}

function parseReturn(text: string, kind: SymbolKind): string {
  const open = text.indexOf("(");
  if (open < 0) return "";
  const close = matchingParen(text, open);
  if (close < 0) return "";
  const after = text.slice(close + 1).trim();
  const arrow = after.match(/^(?::|->)\s*([\s\S]+)$/u);
  if (arrow?.[1]) {
    return arrow[1]
      .replace(/\s+(?:throws|where)\s+[\s\S]*$/u, "")
      .replace(/[:;{]+$/u, "")
      .trim();
  }
  const tuple = after.match(/^\(([^)]*)\)/u);
  if (tuple?.[1]) return splitTopLevel(tuple[1], ",").map(cleanType).join(",");
  let prefix = text.slice(0, open).trim();
  prefix = prefix.replace(/^(?:(?:export|default|public|private|protected|static|abstract|async|final|readonly|function|func|fn|def|fun|pub|unsafe|extern|inline|constexpr|virtual|override)\s+)+/u, "");
  prefix = stripLeadingAngle(prefix);
  const name = prefix.match(/([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?$/u);
  if (name?.index !== undefined) {
    prefix = prefix.slice(0, name.index);
  }
  const words = prefix.split(/\s+/u).filter(Boolean);
  while (words.length > 0 && MODIFIERS.has(words[0] as string)) words.shift();
  return cleanType(words.join(" "));
}

export function parseSignatureText(text: string, kind: SymbolKind): Shape | undefined {
  const open = text.indexOf("(");
  if (open < 0) return undefined;
  const close = matchingParen(text, open);
  if (close < 0) return undefined;
  const paramsText = text.slice(open + 1, close);
  const params = splitTopLevel(paramsText, ",")
    .map(parseParam)
    .filter((param): param is ParamShape => Boolean(param));
  const returnType = parseReturn(text, kind);
  return {
    kind,
    params,
    ...(returnType ? { returnType } : {}),
  };
}
