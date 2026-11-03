export interface Token {
  value: string;
  start: number;
  end: number;
}

export interface LexResult {
  tokens: Token[];
  masked: string;
  error: boolean;
}

const MULTI = [
  "...", "..=", "::", "->", "=>", "..", ":=", "<-", "&&", "||", "==", "!=",
  "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "++", "--",
];

const IDENT_START = /[\p{ID_Start}_]/u;
const IDENT_PART = /[\p{ID_Continue}_]/u;

function isIdent(char: string | undefined): boolean {
  return char !== undefined && IDENT_PART.test(char);
}

function mask(chars: string[], start: number, end: number): void {
  for (let index = start; index < end && index < chars.length; index += 1) {
    if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
  }
}

function rawStringEnd(source: string, start: number): number {
  let index = start;
  if (source[index] === "b") index += 1;
  if (source[index] !== "r") return -1;
  index += 1;
  let hashes = 0;
  while (source[index] === "#") {
    hashes += 1;
    index += 1;
  }
  if (source[index] !== "\"") return -1;
  index += 1;
  const closing = `"${"#".repeat(hashes)}`;
  const found = source.indexOf(closing, index);
  return found < 0 ? -2 : found + closing.length;
}

function charLiteralEnd(source: string, start: number): number {
  if (source[start] !== "'") return -1;
  let index = start + 1;
  if (index >= source.length) return -1;
  if (source[index] === "\\") {
    index += 1;
    while (index < source.length && source[index] !== "'") index += 1;
    return index < source.length ? index + 1 : -1;
  }
  const codepoint = String.fromCodePoint(source.codePointAt(index) ?? 0);
  index += codepoint.length;
  if (source[index] === "'") return index + 1;
  return -1;
}

export function lex(source: string, language: "rust" | "go" | "java"): LexResult {
  const chars = source.split("");
  let error = false;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      let end = index + 2;
      while (end < source.length && source[end] !== "\n") end += 1;
      mask(chars, index, end);
      index = end;
      continue;
    }
    if (char === "/" && next === "*") {
      let end = index + 2;
      let depth = 1;
      while (end < source.length && depth > 0) {
        if (language === "rust" && source[end] === "/" && source[end + 1] === "*") {
          depth += 1;
          end += 2;
          continue;
        }
        if (source[end] === "*" && source[end + 1] === "/") {
          depth -= 1;
          end += 2;
          continue;
        }
        end += 1;
      }
      if (depth > 0) error = true;
      mask(chars, index, end);
      index = end;
      continue;
    }
    if (language === "rust") {
      const rawEnd = rawStringEnd(source, index);
      if (rawEnd !== -1 && (index === 0 || !isIdent(source[index - 1]))) {
        if (rawEnd === -2) error = true;
        const end = rawEnd === -2 ? source.length : rawEnd;
        mask(chars, index, end);
        index = end;
        continue;
      }
      if (char === "b" && next === "\"") {
        let end = index + 2;
        while (end < source.length && source[end] !== "\"") {
          if (source[end] === "\\") end += 1;
          end += 1;
        }
        if (end >= source.length) error = true;
        mask(chars, index, Math.min(end + 1, source.length));
        index = end + 1;
        continue;
      }
    }
    if (char === "\"") {
      let end = index + 1;
      while (end < source.length && source[end] !== "\"") {
        if (source[end] === "\\") end += 1;
        if ((language === "go" || language === "java") && source[end] === "\n") {
          error = true;
          break;
        }
        end += 1;
      }
      if (end >= source.length) error = true;
      mask(chars, index, Math.min(end + 1, source.length));
      index = end + 1;
      continue;
    }
    if (language === "go" && char === "`") {
      const end = source.indexOf("`", index + 1);
      if (end < 0) error = true;
      mask(chars, index, end < 0 ? source.length : end + 1);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === "'") {
      const end = charLiteralEnd(source, index);
      if (end >= 0) {
        mask(chars, index, end);
        index = end;
        continue;
      }
    }
    index += 1;
  }

  const masked = chars.join("");
  const tokens: Token[] = [];
  index = 0;
  while (index < masked.length) {
    const char = masked[index];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (IDENT_START.test(char)) {
      let end = index + 1;
      while (end < masked.length && IDENT_PART.test(masked[end])) end += 1;
      tokens.push({ value: masked.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    if (/[0-9]/u.test(char)) {
      let end = index + 1;
      while (end < masked.length && /[A-Za-z0-9_.]/u.test(masked[end])) end += 1;
      tokens.push({ value: masked.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    const multi = MULTI.find((candidate) => masked.startsWith(candidate, index));
    if (multi) {
      tokens.push({ value: multi, start: index, end: index + multi.length });
      index += multi.length;
      continue;
    }
    tokens.push({ value: char, start: index, end: index + 1 });
    index += 1;
  }
  return { tokens, masked, error };
}
