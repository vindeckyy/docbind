import { stableStringify } from "./canonical.js";
import { isUnionSubset, splitTopLevelUnion } from "../hash.js";
import type { MemberShape, ParamShape, Shape, SymbolKind } from "../types.js";

export interface ShapeDelta {
  breaking: boolean;
  additive: boolean;
  softParamRename: boolean;
  changes: string[];
}

function delta(): ShapeDelta {
  return { breaking: false, additive: false, softParamRename: false, changes: [] };
}

function typeVerdict(oldType: string | undefined, newType: string | undefined): "same" | "additive" | "breaking" {
  if (oldType === newType) return "same";
  if (!oldType) return newType ? "additive" : "same";
  if (!newType) return "breaking";
  if (oldType === "any" || oldType === "unknown" || oldType === "object") return "same";
  if (newType === "any" || newType === "unknown") return "additive";
  const oldParts = splitTopLevelUnion(oldType);
  const newParts = splitTopLevelUnion(newType);
  if (oldParts.length > 1 || newParts.length > 1) {
    if (isUnionSubset(oldParts, newParts)) return "additive";
    return "breaking";
  }
  return "breaking";
}

function merge(target: ShapeDelta, source: ShapeDelta): void {
  target.breaking ||= source.breaking;
  target.additive ||= source.additive;
  target.softParamRename ||= source.softParamRename;
  target.changes.push(...source.changes);
}

function compareParams(oldParams: ParamShape[], newParams: ParamShape[], target: ShapeDelta): void {
  const oldNames = oldParams.map((param) => param.name ?? "");
  const newNames = newParams.map((param) => param.name ?? "");
  if (oldNames.join(",") !== newNames.join(",")) {
    target.softParamRename = true;
  }
  if (newParams.length > oldParams.length) {
    const added = newParams.slice(oldParams.length);
    const required = added.filter((param) => !param.optional && !param.rest && !param.hasDefault);
    if (required.length > 0) {
      target.breaking = true;
      target.changes.push(`added required parameter ${required.map((param) => param.name ?? "?").join(", ")}`);
    } else {
      target.additive = true;
      target.changes.push("added optional parameter");
    }
  } else if (newParams.length < oldParams.length) {
    target.breaking = true;
    target.changes.push("removed parameter");
  }
  const shared = Math.min(oldParams.length, newParams.length);
  for (let index = 0; index < shared; index += 1) {
    const oldParam = oldParams[index];
    const newParam = newParams[index];
    if (oldParam.optional && !newParam.optional) {
      target.breaking = true;
      target.changes.push(`parameter ${newParam.name ?? index + 1} is now required`);
    } else if (!oldParam.optional && newParam.optional) {
      target.additive = true;
      target.changes.push(`parameter ${newParam.name ?? index + 1} is optional`);
    }
    if (oldParam.hasDefault && !newParam.hasDefault && !newParam.optional) {
      target.breaking = true;
      target.changes.push(`parameter ${newParam.name ?? index + 1} lost its default`);
    } else if (!oldParam.hasDefault && newParam.hasDefault) {
      target.additive = true;
    }
    if (oldParam.rest !== newParam.rest) {
      target.breaking = true;
      target.changes.push("parameter rest semantics changed");
    }
    const verdict = typeVerdict(oldParam.type, newParam.type);
    if (verdict === "breaking") {
      target.breaking = true;
      target.changes.push(`parameter ${newParam.name ?? index + 1} type changed from ${oldParam.type || "unknown"} to ${newParam.type || "unknown"}`);
    } else if (verdict === "additive") {
      target.additive = true;
      target.changes.push(`parameter ${newParam.name ?? index + 1} type widened`);
    }
  }
}

function compareMembers(oldMembers: MemberShape[], newMembers: MemberShape[], target: ShapeDelta): void {
  const newByName = new Map(newMembers.map((member) => [member.name, member]));
  const oldByName = new Map(oldMembers.map((member) => [member.name, member]));
  for (const oldMember of oldMembers) {
    const newMember = newByName.get(oldMember.name);
    if (!newMember) {
      target.breaking = true;
      target.changes.push(`removed member ${oldMember.name}`);
      continue;
    }
    merge(target, compareShapeClaims(oldMember.shape, newMember.shape));
    if (oldMember.optional && !newMember.optional) {
      target.breaking = true;
      target.changes.push(`member ${oldMember.name} is now required`);
    } else if (!oldMember.optional && newMember.optional) {
      target.additive = true;
    }
  }
  for (const newMember of newMembers) {
    if (oldByName.has(newMember.name)) continue;
    if (newMember.optional || newMember.kind === "method" || newMember.kind === "function") {
      target.additive = true;
      target.changes.push(`added optional member ${newMember.name}`);
    } else {
      target.breaking = true;
      target.changes.push(`added required member ${newMember.name}`);
    }
  }
}

function compareFunctionLike(oldShape: Shape, newShape: Shape, target: ShapeDelta): void {
  if (stableStringify(oldShape.evaluatedDefault) !== stableStringify(newShape.evaluatedDefault)) {
    target.breaking = true;
    target.changes.push("evaluated default changed");
  }
  if (oldShape.async !== newShape.async) {
    target.breaking = true;
    target.changes.push("sync/async contract changed");
  }
  if (oldShape.generator !== newShape.generator) {
    target.breaking = true;
    target.changes.push("generator contract changed");
  }
  if ((oldShape.typeParams ?? "") !== (newShape.typeParams ?? "")) {
    target.breaking = true;
    target.changes.push("type parameters changed");
  }
  compareParams(oldShape.params ?? [], newShape.params ?? [], target);
  const returnVerdict = typeVerdict(oldShape.returnType, newShape.returnType);
  if (returnVerdict === "breaking") {
    target.breaking = true;
    target.changes.push(`return type changed from ${oldShape.returnType || "unknown"} to ${newShape.returnType || "unknown"}`);
  } else if (returnVerdict === "additive") {
    target.additive = true;
    target.changes.push("return type widened");
  }
  if ((oldShape.visibility ?? "public") !== (newShape.visibility ?? "public")) {
    if ((newShape.visibility ?? "public") !== "public") {
      target.breaking = true;
      target.changes.push("visibility reduced");
    } else {
      target.additive = true;
    }
  }
}

export function compareShapeClaims(oldShape: Shape, newShape: Shape): ShapeDelta {
  const target = delta();
  if (oldShape.kind !== newShape.kind) {
    target.breaking = true;
    target.changes.push(`kind changed from ${oldShape.kind} to ${newShape.kind}`);
    return target;
  }
  if (oldShape.abstract !== newShape.abstract) {
    target.breaking = true;
    target.changes.push("abstract contract changed");
  }
  const oldFlags = new Set(oldShape.flags ?? []);
  const newFlags = new Set(newShape.flags ?? []);
  for (const flag of oldFlags) {
    if (flag === "deprecated") continue;
    if (!newFlags.has(flag)) {
      target.breaking = true;
      target.changes.push(`flag removed: ${flag}`);
    }
  }
  for (const flag of newFlags) {
    if (oldFlags.has(flag) || flag === "deprecated") continue;
    target.additive = true;
    target.changes.push(`flag added: ${flag}`);
  }

  switch (oldShape.kind) {
    case "function":
    case "method":
    case "module":
      compareFunctionLike(oldShape, newShape, target);
      break;
    case "class":
    case "interface":
    case "type":
      if ((oldShape.extends ?? []).join(",") !== (newShape.extends ?? []).join(",")) {
        target.breaking = true;
        target.changes.push("base types changed");
      }
      if ((oldShape.implements ?? []).join(",") !== (newShape.implements ?? []).join(",")) {
        target.breaking = true;
        target.changes.push("implemented interfaces changed");
      }
      if (oldShape.typeShape !== newShape.typeShape) {
        if (newShape.typeShape && oldShape.typeShape) {
          const verdict = typeVerdict(oldShape.typeShape, newShape.typeShape);
          if (verdict === "breaking") {
            target.breaking = true;
            target.changes.push("type shape changed");
          } else if (verdict === "additive") {
            target.additive = true;
          }
        }
      }
      compareMembers(oldShape.members ?? [], newShape.members ?? [], target);
      break;
    case "const":
    case "property":
      {
        const verdict = typeVerdict(oldShape.typeShape, newShape.typeShape);
        if (verdict === "breaking") {
          target.breaking = true;
          target.changes.push("value type changed");
        } else if (verdict === "additive") {
          target.additive = true;
        }
      }
      break;
    case "enum": {
      const newMembers = new Set((newShape.enumMembers ?? []).map((member) => member.name));
      const oldMembers = new Set((oldShape.enumMembers ?? []).map((member) => member.name));
      for (const member of oldMembers) {
        if (!newMembers.has(member)) {
          target.breaking = true;
          target.changes.push(`removed enum member ${member}`);
        }
      }
      for (const member of newMembers) {
        if (!oldMembers.has(member)) target.additive = true;
      }
      break;
    }
    case "enumMember":
      if (oldShape.literalKind !== newShape.literalKind) {
        target.breaking = true;
        target.changes.push("enum value changed");
      }
      if (stableStringify(oldShape.enumArgs ?? []) !== stableStringify(newShape.enumArgs ?? [])) {
        target.breaking = true;
        target.changes.push("enum arguments changed");
      }
      break;
    default:
      break;
  }
  return target;
}

export function isKindCompatible(left: SymbolKind, right: SymbolKind): boolean {
  if (left === right) return true;
  const functions: SymbolKind[] = ["function", "method"];
  const types: SymbolKind[] = ["interface", "type", "class"];
  return (functions.includes(left) && functions.includes(right)) ||
    (types.includes(left) && types.includes(right));
}
