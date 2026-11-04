import type { ParamShape, Shape, SymbolKind } from "../types.js";

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

const TYPE_WORDS = new Set([
  "int", "integer", "string", "str", "bool", "boolean", "void", "long", "double",
  "float", "char", "byte", "short", "object", "any", "number", "bytes", "error",
  "uint", "uint32", "uint64", "int32", "int64", "float32", "float64",
]);

function parseParam(raw: string): ParamShape | undefined {
  let value = raw.trim().replace(/,$/u, "");
  if (!value || value === "self" || value === "&self" || value === "this") return undefined;
  const rest = value.startsWith("...") || value.startsWith("*") || value.startsWith("**");
  value = value.replace(/^\.{3}/u, "").replace(/^\*{1,2}/u, "").trim();
  const hasDefault = value.includes("=");
  value = value.split("=")[0]?.trim() ?? value;
  const optional = value.includes("?");
  value = value.replace(/\?/u, "").trim();
  let name: string | undefined;
  let type = "";
  const colon = value.indexOf(":");
  if (colon >= 0) {
    name = value.slice(0, colon).trim();
    type = value.slice(colon + 1).trim();
  } else {
    const words = value.split(/\s+/u).filter(Boolean);
    if (words.length >= 2) {
      const last = words[words.length - 1] as string;
      const first = words[0] as string;
      if (/^[A-Za-z_$][\w$]*$/u.test(last) && /[<[\]|&*]/u.test(words.slice(0, -1).join(" "))) {
        type = words.slice(0, -1).join(" ");
        name = last;
      } else if (
        /^[A-Za-z_$][\w$]*$/u.test(last) &&
        (TYPE_WORDS.has(first) || /^[A-Z]/u.test(first))
      ) {
        type = words.slice(0, -1).join(" ");
        name = last;
      } else if (/^[A-Za-z_$][\w$]*$/u.test(first)) {
        name = first;
        type = words.slice(1).join(" ");
      } else {
        type = value;
      }
    } else {
      type = value;
    }
  }
  if (!name && !type) return undefined;
  return {
    ...(name ? { name } : {}),
    type,
    optional,
    rest,
    hasDefault,
    kind: "positional",
  };
}

export function parseSignatureText(text: string, kind: SymbolKind): Shape | undefined {
  const open = text.indexOf("(");
  if (open < 0) return undefined;
  const close = matchingParen(text, open);
  if (close < 0) return undefined;
  const paramsText = text.slice(open + 1, close);
  const params = splitTopLevel(paramsText, ",").map(parseParam).filter((param): param is ParamShape => Boolean(param));
  const after = text.slice(close + 1).trim();
  let returnType = "";
  const arrow = after.match(/^(?::|->)\s*([^{;]+)/u);
  const tuple = after.match(/^\(([^)]*)\)/u);
  if (arrow?.[1]) {
    returnType = arrow[1].replace(/[:;]+$/u, "").trim();
  } else if (tuple?.[1]) {
    returnType = splitTopLevel(tuple[1], ",")[0]?.trim() ?? "";
  } else {
    const before = text.slice(0, open).trim();
    const words = before.split(/\s+/u).filter(Boolean);
    const name = words[words.length - 1] ?? "";
    const prefix = words.slice(0, -1).filter(
      (word) => !/^(?:export|default|public|private|protected|static|abstract|async|final|readonly|function|func|fn|def|fun|pub|unsafe|extern)$/u.test(word),
    );
    returnType = prefix[prefix.length - 1] ?? "";
  }
  return {
    kind,
    params,
    ...(returnType ? { returnType } : {}),
  };
}
