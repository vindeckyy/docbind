import { hashText, normalizeText } from "../hash.js";
import type { ContractFlag, ParamShape, Shape } from "../types.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) output[key] = sortValue(record[key]);
    }
    return output;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function paramForHash(param: ParamShape): Record<string, unknown> {
  return {
    type: param.type,
    optional: param.optional,
    rest: param.rest,
    hasDefault: param.hasDefault,
    kind: param.kind ?? "positional",
  };
}

function shapeForHash(shape: Shape): Record<string, unknown> {
  const output: Record<string, unknown> = { kind: shape.kind };
  if (shape.async !== undefined) output.async = shape.async;
  if (shape.generator !== undefined) output.generator = shape.generator;
  if (shape.abstract !== undefined) output.abstract = shape.abstract;
  if (shape.typeParams) output.typeParams = shape.typeParams;
  if (shape.params) output.params = shape.params.map(paramForHash);
  if (shape.returnType !== undefined) output.returnType = shape.returnType;
  if (shape.visibility) output.visibility = shape.visibility;
  if (shape.flags?.length) output.flags = [...shape.flags].sort();
  if (shape.extends?.length) output.extends = [...shape.extends].sort();
  if (shape.implements?.length) output.implements = [...shape.implements].sort();
  if (shape.members) {
    output.members = [...shape.members]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((member) => ({
        name: member.name,
        kind: member.kind,
        optional: member.optional,
        shape: JSON.parse(canonicalShape(member.shape)) as unknown,
      }));
  }
  if (shape.typeShape !== undefined) output.typeShape = shape.typeShape;
  if (shape.literalKind) output.literalKind = shape.literalKind;
  if (shape.enumMembers) {
    output.enumMembers = [...shape.enumMembers].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (shape.enumArgs?.length) output.enumArgs = shape.enumArgs;
  if (shape.overload !== undefined) output.overload = shape.overload;
  return output;
}

export function canonicalShape(shape: Shape): string {
  return stableStringify(shapeForHash(shape));
}

export function shapeHash(shape: Shape): string {
  return hashText(canonicalShape(shape));
}

export function paramNamesHash(params: ParamShape[] | undefined): string {
  return hashText((params ?? []).map((param) => param.name ?? "").join(","));
}

export function bodyHash(body: string | undefined): string {
  return hashText(normalizeText(body ?? ""));
}

export function flagsFromNames(names: string[]): ContractFlag[] {
  const flags: ContractFlag[] = [];
  for (const name of names) {
    const cleaned = name.replace(/^@/u, "");
    if (
      cleaned === "deprecated" ||
      cleaned === "async" ||
      cleaned === "generator" ||
      cleaned === "abstract" ||
      cleaned === "readonly" ||
      cleaned === "static" ||
      cleaned === "unsafe"
    ) {
      flags.push(cleaned);
    }
  }
  return flags;
}

export function shapeTokens(shapeText: string): Set<string> {
  return new Set(
    shapeText
      .toLowerCase()
      .split(/[^a-z0-9_$.]+/u)
      .filter((token) => token.length > 1),
  );
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}
