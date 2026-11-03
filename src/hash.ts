import { createHash } from "node:crypto";

export function hashText(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeType(value: string): string {
  return normalizeText(value)
    .replace(/\s*([<>{}[\]();,|&:=?])\s*/g, "$1")
    .replace(/;$/, "");
}

export function splitTopLevelUnion(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<" || char === "(" || char === "{" || char === "[") {
      depth += 1;
    } else if (char === ">" || char === ")" || char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
    } else if (char === "|" && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

export function isUnionSubset(subset: string[], superset: string[]): boolean {
  const values = new Set(superset);
  return subset.every((value) => values.has(value));
}
