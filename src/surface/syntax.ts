import { normalizeType } from "../hash.js";
import type { Token } from "./lex.js";

export function tokenText(masked: string, tokens: Token[], start: number, end: number): string {
  if (start >= end || start < 0 || end > tokens.length) return "";
  return normalizeType(masked.slice(tokens[start].start, tokens[end - 1].end));
}

export function findMatching(
  tokens: Token[],
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    else if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function splitTopLevel(
  tokens: Token[],
  start: number,
  end: number,
  separator = ",",
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let segmentStart = start;
  for (let index = start; index < end; index += 1) {
    const value = tokens[index].value;
    if (["(", "[", "{", "<"].includes(value)) depth += 1;
    else if ([")", "]", "}", ">"].includes(value)) depth = Math.max(0, depth - 1);
    else if (value === separator && depth === 0) {
      if (index > segmentStart) ranges.push([segmentStart, index]);
      segmentStart = index + 1;
    }
  }
  if (end > segmentStart) ranges.push([segmentStart, end]);
  return ranges;
}

export function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

export function isExportedGo(name: string): boolean {
  const first = name.codePointAt(0);
  return first !== undefined && first >= 65 && first <= 90;
}
