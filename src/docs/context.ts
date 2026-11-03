import { hashText, normalizeText } from "../hash.js";

export const NEGATIVE_CUES = [
  "deprecated",
  "removed",
  "renamed",
  "renames",
  "no longer",
  "formerly",
  "was called",
  "before v",
  "in v1",
  "migration",
  "breaking change",
];

export function contextFingerprint(parts: string[], token: string): string {
  const text = normalizeText(parts.filter(Boolean).join("\n")).split(token).join("<ref>");
  return hashText(text, 16);
}

export function hasNegativeCue(text: string): boolean {
  const lower = text.toLowerCase();
  return NEGATIVE_CUES.some((cue) => lower.includes(cue));
}
