import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot, modulePathFor } from "../discover.js";
import {
  bodyHash,
  canonicalShape,
  paramNamesHash,
  shapeHash,
} from "../shape/canonical.js";
import { findMatching } from "./syntax.js";
import { lex, type LexResult, type Token } from "./lex.js";
import type { DocstringEntry, ExtractResult } from "./protocol.js";
import type {
  AnnotationArgument,
  AnnotationShape,
  ContractFlag,
  EnumMemberShape,
  EvaluatedValue,
  ParamShape,
  Shape,
  Symbol,
} from "../types.js";

interface JavaDraft {
  name: string;
  kind: "class" | "interface" | "enum" | "enumMember" | "method" | "property";
  shape: Shape;
  start: number;
  body: string;
  path: string;
  parentPath?: string;
  defaultValue?: string;
  defaultParsed?: Pick<AnnotationArgument, "kind" | "literal" | "items">;
}

interface JavaContext {
  source: string;
  lexed: LexResult;
  filePath: string;
  packageName: string;
  packageRoot: string;
  modulePath: string;
  packageClause: string;
  drafts: JavaDraft[];
  types: Array<{ name: string; start: number; end: number }>;
  constants: Map<string, EvaluatedConstant>;
  evaluateDefaults: boolean;
  failures: number;
}

interface JavaAnnotation {
  name: string;
  args?: string;
}

function splitArguments(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] as string;
    if (quote) {
      if (char === quote && raw[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (["(", "[", "{"].includes(char)) depth += 1;
    else if ([")", "]", "}"].includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function argumentAssignment(part: string): { name?: string; value: string } {
  let depth = 0;
  let quote = "";
  for (let index = 0; index < part.length; index += 1) {
    const char = part[index] as string;
    if (quote) {
      if (char === quote && part[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (["(", "[", "{"].includes(char)) depth += 1;
    else if ([")", "]", "}"].includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "=" && depth === 0) {
      return { name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() };
    }
  }
  return { value: part };
}

function nestedAnnotationArguments(text: string): AnnotationArgument[] {
  const open = text.indexOf("(");
  if (open < 0) return [];
  let depth = 0;
  let quote = "";
  for (let index = open; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      /* v8 ignore next */
      if (depth === 0) return annotationArguments(text.slice(open + 1, index));
    }
  }
  return [];
}

function annotationLiteral(raw: string): Pick<AnnotationArgument, "kind" | "literal" | "items"> {
  const text = raw.trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    return { kind: "array", items: splitArguments(text.slice(1, -1)).map(annotationArgument) };
  }
  if (text.startsWith("@")) {
    return { kind: "annotation", items: nestedAnnotationArguments(text) };
  }
  if (/^"(?:\\\\.|[^"\\\\])*"$/su.test(text)) {
    try {
      return { kind: "string", literal: JSON.parse(text) as string };
    } catch {
      return { kind: "string", literal: text.slice(1, -1) };
    }
  }
  if (/^'(?:\\\\.|[^'\\\\])*'$/su.test(text)) {
    return { kind: "string", literal: text.slice(1, -1) };
  }
  if (text === "true" || text === "false") return { kind: "boolean", literal: text === "true" };
  if (/^[-+]?(?:0x[0-9a-f]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?[fFdDlL]?$/iu.test(text)) {
    const numeric = Number(text.replace(/[fFdDlL]$/u, ""));
    if (Number.isFinite(numeric)) return { kind: "number", literal: numeric };
  }
  if (/\.class$/u.test(text)) return { kind: "class", literal: text.slice(0, -6) };
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(text)) return { kind: "enum", literal: text };
  return { kind: "expression" };
}

function annotationArgument(part: string): AnnotationArgument {
  const { name, value } = argumentAssignment(part);
  return { ...(name ? { name } : {}), value, ...annotationLiteral(value) };
}

function annotationArguments(raw: string): AnnotationArgument[] {
  return splitArguments(raw).map(annotationArgument);
}

interface ExpressionToken {
  type: "number" | "string" | "ident" | "op";
  value: string;
  number?: number;
}

function expressionTokens(source: string): ExpressionToken[] | undefined {
  const tokens: ExpressionToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === "\"") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        if (source[end] === "\"") {
          end += 1;
          break;
        }
        end += 1;
      }
      /* v8 ignore next */
      if (source[end - 1] !== "\"") return undefined;
      const raw = source.slice(index, end);
      let value: string;
      try {
        value = JSON.parse(raw) as string;
      } catch {
        value = raw.slice(1, -1);
      }
      tokens.push({ type: "string", value });
      index = end;
      continue;
    }
    if (/[0-9.]/u.test(char)) {
      const match = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?[fFdDlL]?/u.exec(source.slice(index));
      if (!match) return undefined;
      const text = match[0];
      const numeric = Number(text.replace(/[fFdDlL]$/u, ""));
      if (!Number.isFinite(numeric)) return undefined;
      tokens.push({ type: "number", value: text, number: numeric });
      index += text.length;
      continue;
    }
    if (/[A-Za-z_$]/u.test(char)) {
      const match = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/u.exec(source.slice(index));
      /* v8 ignore next */
      if (!match) return undefined;
      tokens.push({ type: "ident", value: match[0] });
      index += match[0].length;
      continue;
    }
    if ("+-*/()&|^,".includes(char)) {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    if (char === "<" || char === ">") {
      let end = index;
      while (source[end] === char) end += 1;
      const operator = source.slice(index, end);
      if (operator !== "<<" && operator !== ">>" && operator !== ">>>") return undefined;
      tokens.push({ type: "op", value: operator });
      index = end;
      continue;
    }
    return undefined;
  }
  return tokens;
}

interface EvaluatedConstant {
  value: EvaluatedValue;
  integral: boolean;
  width?: "int" | "long";
}

const CAST_TYPES = new Set(["int", "long", "short", "byte", "double", "float"]);

const REFERENCE_CAST_TYPES = new Set([
  "String",
  "Object",
  "Number",
  "CharSequence",
  "Integer",
  "Long",
  "Short",
  "Byte",
  "Double",
  "Float",
  "Boolean",
]);

function isIntegralLiteral(text: string): boolean {
  return /^(?:0[xX][0-9a-fA-F]+|\d+)[lL]?$/u.test(text);
}

function isIntegralType(type: string | undefined): boolean {
  return Boolean(type && /^(?:int|long|short|byte|Integer|Long|Short|Byte)$/u.test(type.trim()));
}

function integralWidth(type: string): "int" | "long" {
  const name = type.trim();
  return name === "long" || name === "Long" ? "long" : "int";
}

function literalWidth(text: string): "int" | "long" {
  return /[lL]$/u.test(text) ? "long" : "int";
}

function toBigInt(value: EvaluatedValue): bigint | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  /* v8 ignore next */
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return BigInt(value);
  return undefined;
}

function fromBigInt(value: bigint): number | string {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : value.toString();
}

function applyMath(name: string, args: EvaluatedConstant[]): EvaluatedConstant | undefined {
  if (name === "Math.abs" && args.length === 1) {
    const argument = args[0] as EvaluatedConstant;
    if (!argument.integral) {
      return typeof argument.value === "number"
        ? { value: Math.abs(argument.value), integral: false }
        : undefined;
    }
    const big = toBigInt(argument.value) as bigint;
    return {
      value: fromBigInt(big < 0n ? -big : big),
      integral: true,
      /* v8 ignore next */
      ...(argument.width ? { width: argument.width } : {}),
    };
  }
  if (name === "Math.sqrt" && args.length === 1) {
    const argument = args[0] as EvaluatedConstant;
    const numeric =
      typeof argument.value === "number" ? argument.value : Number(toBigInt(argument.value) as bigint);
    if (!Number.isFinite(numeric) || numeric < 0) return undefined;
    return { value: Math.sqrt(numeric), integral: false };
  }
  if (name === "Math.pow" && args.length === 2) {
    const [base, exponent] = args as [EvaluatedConstant, EvaluatedConstant];
    const baseNumber = typeof base.value === "number" ? base.value : Number(toBigInt(base.value) as bigint);
    const exponentNumber =
      typeof exponent.value === "number" ? exponent.value : Number(toBigInt(exponent.value) as bigint);
    /* v8 ignore next */
    if (!Number.isFinite(baseNumber) || !Number.isFinite(exponentNumber)) return undefined;
    const result = Math.pow(baseNumber, exponentNumber);
    return Number.isFinite(result) ? { value: result, integral: false } : undefined;
  }
  if ((name === "Math.round" || name === "Math.floor" || name === "Math.ceil") && args.length === 1) {
    const argument = args[0] as EvaluatedConstant;
    if (argument.integral) {
      if (name === "Math.round") return argument;
      return { value: argument.value, integral: false };
    }
    if (typeof argument.value !== "number") return undefined;
    if (name === "Math.round") {
      return { value: Math.round(argument.value), integral: true, width: "long" };
    }
    return {
      value: name === "Math.floor" ? Math.floor(argument.value) : Math.ceil(argument.value),
      integral: false,
    };
  }
  if ((name === "Math.max" || name === "Math.min") && args.length >= 2) {
    if (args.every((argument) => argument.integral)) {
      const width = args.some((argument) => argument.width === "long") ? "long" : "int";
      let chosen = args[0] as EvaluatedConstant;
      for (const argument of args.slice(1)) {
        const left = toBigInt(chosen.value) as bigint;
        const right = toBigInt(argument.value) as bigint;
        if (name === "Math.max" ? right > left : right < left) chosen = argument;
      }
      return { value: chosen.value, integral: true, width };
    }
    if (args.every((argument) => typeof argument.value === "number")) {
      return {
        value: name === "Math.max" ? Math.max(...(args.map((argument) => argument.value) as number[])) : Math.min(...(args.map((argument) => argument.value) as number[])),
        integral: false,
      };
    }
  }
  return undefined;
}

function evaluateExpression(
  source: string,
  constants?: Map<string, EvaluatedConstant>,
): EvaluatedConstant | undefined {
  const tokens = expressionTokens(source);
  if (!tokens || tokens.length === 0) return undefined;
  let position = 0;

  const parsePrimary = (): EvaluatedConstant | undefined => {
    const token = tokens[position];
    if (!token) return undefined;
    if (token.type === "number") {
      position += 1;
      const integral = isIntegralLiteral(token.value);
      return {
        value: token.number as number,
        integral,
        ...(integral ? { width: literalWidth(token.value) } : {}),
      };
    }
    if (token.type === "string") {
      position += 1;
      return { value: token.value, integral: false };
    }
    if (token.type === "ident") {
      const name = token.value;
      position += 1;
      if (tokens[position]?.value === "(") {
        position += 1;
        const args: EvaluatedConstant[] = [];
        if (tokens[position]?.value !== ")") {
          while (true) {
            const value = parseOr();
            if (value === undefined) return undefined;
            args.push(value);
            if (tokens[position]?.value !== ",") break;
            position += 1;
          }
        }
        if (tokens[position]?.value !== ")") return undefined;
        position += 1;
        return applyMath(name, args);
      }
      if (name === "true" || name === "false") {
        return { value: name === "true", integral: false };
      }
      return constants?.get(name);
    }
    if (token.type === "op" && token.value === "(") {
      const type = tokens[position + 1];
      const close = tokens[position + 2];
      if (type?.type === "ident" && REFERENCE_CAST_TYPES.has(type.value) && close?.value === ")") {
        position += 3;
        const operand = parsePrimary();
        if (operand === undefined) return undefined;
        if (type.value === "String" || type.value === "CharSequence") {
          return typeof operand.value === "string" ? { value: operand.value, integral: false } : undefined;
        }
        if (type.value === "Boolean") {
          return typeof operand.value === "boolean" ? { value: operand.value, integral: false } : undefined;
        }
        if (type.value === "Integer" || type.value === "Short" || type.value === "Byte") {
          return typeof operand.value === "number"
            ? { value: operand.value, integral: true, width: "int" }
            : undefined;
        }
        if (type.value === "Long") {
          return typeof operand.value === "number"
            ? { value: operand.value, integral: true, width: "long" }
            : undefined;
        }
        if (type.value === "Double" || type.value === "Float") {
          return typeof operand.value === "number" ? { value: operand.value, integral: false } : undefined;
        }
        if (type.value === "Number" && typeof operand.value !== "number") return undefined;
        return operand;
      }
      if (type?.type === "ident" && CAST_TYPES.has(type.value) && close?.value === ")") {
        position += 3;
        const operand = parsePrimary();
        if (operand === undefined) return undefined;
        const integral = type.value !== "double" && type.value !== "float";
        if (!integral) {
          if (typeof operand.value !== "number") return undefined;
          return { value: operand.value, integral: false };
        }
        const width = integralWidth(type.value);
        if (operand.integral) {
          const big = toBigInt(operand.value) as bigint;
          return {
            value: width === "long" ? fromBigInt(BigInt.asIntN(64, big)) : Number(BigInt.asIntN(32, big)),
            integral: true,
            width,
          };
        }
        if (typeof operand.value !== "number") return undefined;
        const truncated = Math.trunc(operand.value);
        return {
          value: width === "long" ? truncated : Number(BigInt.asIntN(32, BigInt(truncated))),
          integral: true,
          width,
        };
      }
      position += 1;
      const value = parseOr();
      if (value === undefined || tokens[position]?.value !== ")") return undefined;
      position += 1;
      return value;
    }
    /* v8 ignore next */
    if (token.type === "op" && token.value === "-") {
      position += 1;
      const value = parsePrimary();
      if (value?.integral) {
        const big = toBigInt(value.value) as bigint;
        return {
          value: fromBigInt(-big),
          integral: true,
          ...(value.width ? { width: value.width } : {}),
        };
      }
      return typeof value?.value === "number" ? { value: -value.value, integral: false } : undefined;
    }
    return undefined;
  };

  const parseMul = (): EvaluatedConstant | undefined => {
    let left = parsePrimary();
    while (left !== undefined && tokens[position]?.type === "op") {
      const operator = tokens[position]?.value as string;
      if (operator !== "*" && operator !== "/") break;
      position += 1;
      const rightValue = parsePrimary();
      if (rightValue === undefined) return undefined;
      const integral = left.integral && rightValue.integral;
      if (integral) {
        const a = toBigInt(left.value) as bigint;
        const b = toBigInt(rightValue.value) as bigint;
        if (operator === "/" && b === 0n) return undefined;
        const width = left.width === "long" || rightValue.width === "long" ? "long" : "int";
        const value =
          operator === "*" ? fromBigInt(BigInt.asIntN(64, a * b)) : fromBigInt(a / b);
        left = { value, integral: true, width };
        continue;
      }
      if (typeof left.value !== "number" || typeof rightValue.value !== "number") return undefined;
      if (operator === "/" && rightValue.value === 0) return undefined;
      left = {
        value: operator === "*" ? left.value * rightValue.value : left.value / rightValue.value,
        integral: false,
      };
    }
    return left;
  };

  const parseAdd = (): EvaluatedConstant | undefined => {
    let left = parseMul();
    while (left !== undefined && tokens[position]?.type === "op") {
      const operator = tokens[position]?.value as string;
      if (operator !== "+" && operator !== "-") break;
      position += 1;
      const rightValue = parseMul();
      if (rightValue === undefined) return undefined;
      const stringConcat =
        (typeof left.value === "string" && !left.integral) ||
        (typeof rightValue.value === "string" && !rightValue.integral);
      if (operator === "+" && stringConcat) {
        left = { value: `${left.value}${rightValue.value}`, integral: false };
        continue;
      }
      const integral = left.integral && rightValue.integral;
      if (integral) {
        const a = toBigInt(left.value) as bigint;
        const b = toBigInt(rightValue.value) as bigint;
        const width = left.width === "long" || rightValue.width === "long" ? "long" : "int";
        left = {
          value: fromBigInt(BigInt.asIntN(64, operator === "+" ? a + b : a - b)),
          integral: true,
          width,
        };
        continue;
      }
      if (typeof left.value !== "number" || typeof rightValue.value !== "number") return undefined;
      left = {
        value: operator === "+" ? left.value + rightValue.value : left.value - rightValue.value,
        integral: false,
      };
    }
    return left;
  };

  const parseShift = (): EvaluatedConstant | undefined => {
    let left = parseAdd();
    while (left !== undefined && tokens[position]?.type === "op") {
      const operator = tokens[position]?.value as string;
      if (operator !== "<<" && operator !== ">>" && operator !== ">>>") break;
      position += 1;
      const rightValue = parseAdd();
      if (!left.integral || !rightValue?.integral) return undefined;
      const leftBig = toBigInt(left.value) as bigint;
      const rightBig = toBigInt(rightValue.value) as bigint;
      const width = left.width === "long" ? "long" : "int";
      let value: number | string;
      if (width === "long") {
        const a = leftBig;
        const shift = BigInt(Number(rightValue.value) & 63);
        const shifted =
          operator === "<<"
            ? a << shift
            : operator === ">>"
              ? a >> shift
              : BigInt.asUintN(64, a) >> shift;
        value = fromBigInt(BigInt.asIntN(64, shifted));
      } else {
        value =
          operator === "<<"
            ? Number(leftBig) << Number(rightBig)
            : operator === ">>"
              ? Number(leftBig) >> Number(rightBig)
              : Number(leftBig) >>> Number(rightBig);
      }
      left = { value, integral: true, width };
    }
    return left;
  };

  const parseBitwise = (
    next: () => EvaluatedConstant | undefined,
    operators: string[],
  ): EvaluatedConstant | undefined => {
    let left = next();
    while (left !== undefined && tokens[position]?.type === "op") {
      const operator = tokens[position]?.value as string;
      if (!operators.includes(operator)) break;
      position += 1;
      const rightValue = next();
      if (!left.integral || !rightValue?.integral) return undefined;
      const a = toBigInt(left.value) as bigint;
      const b = toBigInt(rightValue.value) as bigint;
      const width = left.width === "long" || rightValue.width === "long" ? "long" : "int";
      let value: number | string;
      if (width === "long") {
        value = fromBigInt(BigInt.asIntN(64, operator === "&" ? a & b : operator === "^" ? a ^ b : a | b));
      } else {
        value =
          operator === "&"
            ? Number(a) & Number(b)
            : operator === "^"
              ? Number(a) ^ Number(b)
              : Number(a) | Number(b);
      }
      left = { value, integral: true, width };
    }
    return left;
  };

  const parseAnd = (): EvaluatedConstant | undefined => parseBitwise(parseShift, ["&"]);
  const parseXor = (): EvaluatedConstant | undefined => parseBitwise(parseAnd, ["^"]);
  const parseOr = (): EvaluatedConstant | undefined => parseBitwise(parseXor, ["|"]);

  const result = parseOr();
  if (result === undefined || position !== tokens.length) return undefined;
  return result;
}

function evaluateArgument(
  argument: AnnotationArgument,
  constants?: Map<string, EvaluatedConstant>,
  enumLabels?: Set<string>,
): EvaluatedConstant | undefined {
  if (argument.kind === "string" || argument.kind === "number" || argument.kind === "boolean") {
    const integral = argument.kind === "number" && isIntegralLiteral(argument.value);
    return {
      value: argument.literal as EvaluatedValue,
      integral,
      ...(integral ? { width: literalWidth(argument.value) } : {}),
    };
  }
  if (argument.kind === "enum") {
    const literal = argument.literal as string;
    const direct = constants?.get(literal);
    if (direct !== undefined) return direct;
    return enumLabels?.has(literal) ? { value: literal, integral: false } : undefined;
  }
  if (argument.kind === "class") {
    return { value: argument.literal as string, integral: false };
  }
  if (argument.kind === "array") {
    const values = (argument.items as AnnotationArgument[]).map((item) =>
      evaluateArgument(item, constants, enumLabels),
    );
    if (values.some((value) => value === undefined)) return undefined;
    return { value: values.map((value) => (value as EvaluatedConstant).value), integral: false };
  }
  if (argument.kind === "expression") {
    return evaluateExpression(argument.value, constants);
  }
  /* v8 ignore next */
  if (argument.kind === "annotation") {
    const evaluated: Record<string, EvaluatedValue> = {};
    let position = 0;
    for (const item of argument.items as AnnotationArgument[]) {
      const value = evaluateArgument(item, constants, enumLabels);
      if (value === undefined) return undefined;
      evaluated[item.name ?? `arg${position}`] = value.value;
      position += 1;
    }
    return { value: evaluated, integral: false };
  }
  return undefined;
}

function javaAnnotations(annotations: JavaAnnotation[]): AnnotationShape[] {
  return annotations.map((annotation) => ({
    name: annotation.name.split(".").pop() as string,
    ...(annotation.args ? { args: annotationArguments(annotation.args) } : {}),
  }));
}

function javaFlags(annotations: JavaAnnotation[]): ContractFlag[] {
  const flags: ContractFlag[] = [];
  for (const annotation of annotations) {
    const simple = annotation.name.split(".").pop() as string;
    if (simple === "Deprecated") flags.push("deprecated");
    else if (simple !== "Override") {
      flags.push(`annotation:${simple}${annotation.args ? `(${annotation.args})` : ""}`);
    }
  }
  return flags;
}

const MODIFIERS = new Set([
  "public", "protected", "private", "static", "final", "abstract", "native",
  "synchronized", "transient", "volatile", "strictfp", "default", "sealed",
  "non-sealed",
]);

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function tokensText(source: string, tokens: Token[], start: number, end: number): string {
  /* v8 ignore next */
  if (end <= start) return "";
  const first = tokens[start] as Token;
  const last = tokens[end - 1] as Token;
  return source.slice(first.start, last.end);
}

function javaParams(tokens: Token[], start: number, end: number): ParamShape[] {
  const parts: Array<[number, number]> = [];
  let depth = 0;
  let segment = start;
  for (let index = start; index < end; index += 1) {
    const value = (tokens[index] as Token).value;
    if (["<", "(", "[", "{"].includes(value)) depth += 1;
    else if ([">", ")", "]", "}"].includes(value)) depth = Math.max(0, depth - 1);
    else if (value === "," && depth === 0) {
      /* v8 ignore next */
      if (index > segment) parts.push([segment, index]);
      segment = index + 1;
    }
  }
  if (end > segment) parts.push([segment, end]);
  return parts.map(([from, to]) => {
    let cursor = from;
    while (cursor < to) {
      const qualifier = (tokens[cursor] as Token).value;
      if (qualifier === "final") {
        cursor += 1;
        continue;
      }
      if (qualifier !== "@") break;
      cursor += 1;
      if (cursor < to) cursor += 1;
      while (
        cursor + 1 < to &&
        (tokens[cursor] as Token).value === "." &&
        /^[A-Za-z_]/u.test((tokens[cursor + 1] as Token).value)
      ) {
        cursor += 2;
      }
      if (cursor < to && (tokens[cursor] as Token).value === "(") {
        const close = findMatching(tokens, cursor, "(", ")");
        /* v8 ignore next */
        cursor = close < 0 ? to : close + 1;
      }
    }
    let nameIndex = to - 1;
    while (nameIndex >= cursor && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = nameIndex >= cursor ? (tokens[nameIndex] as Token).value : "";
    const type = tokens
      .slice(cursor, Math.max(cursor, nameIndex))
      .map((token) => token.value)
      .join(" ")
      .replace(/\[\s*\]/gu, "[]")
      .replace(/\s*<\s*/gu, "<")
      .replace(/\s*>\s*/gu, ">")
      .trim();
    return {
      name,
      kind: "positional",
      type,
      optional: false,
      rest: tokens.slice(cursor, to).some((token) => token.value === "..."),
      hasDefault: false,
    };
  });
}

class JavaParser {
  constructor(private readonly context: JavaContext) {}

  parse(): void {
    const tokens = this.context.lexed.tokens;
    let index = 0;
    let annotations: JavaAnnotation[] = [];
    while (index < tokens.length) {
      const token = tokens[index] as Token;
      if (token.value === "package") {
        let cursor = index + 1;
        const parts: string[] = [];
        while (cursor < tokens.length && (tokens[cursor] as Token).value !== ";") {
          parts.push((tokens[cursor] as Token).value);
          cursor += 1;
        }
        this.context.packageClause = parts.join("");
        index = cursor + 1;
        continue;
      }
      if (token.value === "@" && (tokens[index + 1] as Token | undefined)?.value === "interface") {
        const end = this.parseType(index + 1, "", annotations, true);
        annotations = [];
        index = Math.max(end, index + 2);
        continue;
      }
      if (token.value === "@") {
        const annotation = this.annotationAt(index);
        if (annotation.name) annotations.push(annotation);
        index = annotation.end;
        continue;
      }
      if (token.value === "class" || token.value === "interface" || token.value === "enum" || token.value === "record") {
        const end = this.parseType(index, "", annotations);
        annotations = [];
        index = Math.max(end, index + 1);
        continue;
      }
      index += 1;
    }
  }

  private visibilityBefore(index: number): string {
    const tokens = this.context.lexed.tokens;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const value = (tokens[cursor] as Token).value;
      if (value === "public" || value === "protected" || value === "private") return value;
      /* v8 ignore next */
      if ([";", "}", "{"].includes(value)) break;
    }
    return "package";
  }

  private annotationAt(index: number): JavaAnnotation & { end: number } {
    const tokens = this.context.lexed.tokens;
    let cursor = index + 1;
    let name = "";
    if (cursor < tokens.length) {
      const first = tokens[cursor] as Token;
      if (/^[A-Za-z_]/u.test(first.value)) {
        name = first.value;
        cursor += 1;
      }
    }
    while (cursor + 1 < tokens.length) {
      const dot = tokens[cursor] as Token;
      const next = tokens[cursor + 1] as Token;
      if (dot.value !== "." || !/^[A-Za-z_]/u.test(next.value)) break;
      name = `${name}.${next.value}`;
      cursor += 2;
    }
    let args: string | undefined;
    if ((tokens[cursor] as Token | undefined)?.value === "(") {
      const close = findMatching(tokens, cursor, "(", ")");
      if (close > cursor) {
        const raw = this.context.source
          .slice((tokens[cursor] as Token).end, (tokens[close] as Token).start)
          .replace(/\s+/gu, " ")
          .trim();
        if (raw.length > 0) args = raw;
      }
      cursor = close < 0 ? cursor + 1 : close + 1;
    }
    return { end: cursor, name, ...(args ? { args } : {}) };
  }

  private parseType(
    index: number,
    namespace = "",
    annotations: JavaAnnotation[] = [],
    annotationType = false,
  ): number {
    const tokens = this.context.lexed.tokens;
    const keyword = (tokens[index] as Token).value;
    const nameToken = tokens[index + 1] as Token | undefined;
    if (!nameToken || !/^[A-Za-z_]/u.test(nameToken.value)) return index + 1;
    const visibility = this.visibilityBefore(index);
    let cursor = index + 2;
    let brace = -1;
    while (cursor < tokens.length) {
      const value = (tokens[cursor] as Token).value;
      if (value === "{") {
        brace = cursor;
        break;
      }
      /* v8 ignore next */
      if (value === ";") return cursor + 1;
      cursor += 1;
    }
    if (brace < 0) return index + 1;
    const close = findMatching(tokens, brace, "{", "}");
    if (close < 0) {
      this.context.failures += 1;
      return tokens.length;
    }
    const kind = keyword === "enum" ? "enum" : keyword === "interface" ? "interface" : "class";
    const path = `${namespace}${nameToken.value}`;
    this.context.types.push({
      name: path,
      start: (tokens[index] as Token).start,
      end: (tokens[close] as Token).end,
    });
    let memberStart = brace + 1;
    let enumMembers: EnumMemberShape[] | undefined;
    if (kind === "enum") {
      const parsed = this.enumConstants(path, brace + 1, close);
      enumMembers = parsed.members;
      memberStart = parsed.end;
    }
    this.context.drafts.push({
      name: nameToken.value,
      kind,
      shape: {
        kind,
        extends: [],
        members: [],
        flags: [...javaFlags(annotations), ...(annotationType ? ["annotation-type" as ContractFlag] : [])],
        visibility,
        ...(enumMembers && enumMembers.length > 0 ? { enumMembers } : {}),
        ...(annotations.length > 0 ? { annotations: javaAnnotations(annotations) } : {}),
      },
      start: nameToken.start,
      body: tokensText(this.context.source, tokens, brace, close + 1),
      path,
      ...(namespace ? { parentPath: namespace.slice(0, -1) } : {}),
    });
    this.parseMembers(path, memberStart, close, kind === "interface");
    return close + 1;
  }

  private enumConstants(
    typePath: string,
    start: number,
    end: number,
  ): { members: EnumMemberShape[]; end: number } {
    const tokens = this.context.lexed.tokens;
    const members: EnumMemberShape[] = [];
    let depth = 0;
    let segmentStart = start;
    let index = start;
    const flush = (segmentEnd: number): void => {
      let cursor = segmentStart;
      while (cursor < segmentEnd) {
        const value = (tokens[cursor] as Token).value;
        if (value === "@") {
          cursor += 2;
          if ((tokens[cursor] as Token | undefined)?.value === "(") {
            const close = findMatching(tokens, cursor, "(", ")");
            cursor = close < 0 ? segmentEnd : close + 1;
          }
          continue;
        }
        if (/^[A-Za-z_]/u.test(value)) {
          const path = `${typePath}.${value}`;
          const start = (tokens[cursor] as Token).start;
          let args: string | undefined;
          cursor += 1;
          if ((tokens[cursor] as Token | undefined)?.value === "(") {
            const close = findMatching(tokens, cursor, "(", ")");
            if (close > cursor) {
              const raw = this.context.source
                .slice((tokens[cursor] as Token).end, (tokens[close] as Token).start)
                .replace(/\s+/gu, " ")
                .trim();
              if (raw.length > 0) args = raw;
            }
            cursor = close < 0 ? segmentEnd : close + 1;
          }
          const argValues = args ? annotationArguments(args) : undefined;
          this.context.drafts.push({
            name: value,
            kind: "enumMember",
            path,
            parentPath: typePath,
            start,
            body: "",
            shape: {
              kind: "enumMember",
              flags: [],
              ...(argValues ? { enumArgs: argValues } : {}),
            },
          });
          if ((tokens[cursor] as Token | undefined)?.value === "{") {
            const close = findMatching(tokens, cursor, "{", "}");
            /* v8 ignore next */
            if (close > cursor) {
              this.parseMembers(path, cursor + 1, close, false);
            }
            /* v8 ignore next */
            cursor = close < 0 ? segmentEnd : close + 1;
          }
          members.push({
            name: value,
            value: args ?? "",
            ...(args ? { args, argValues } : {}),
          });
          return;
        }
        cursor += 1;
      }
    };
    while (index < end) {
      const value = (tokens[index] as Token).value;
      if (["(", "[", "{"].includes(value)) depth += 1;
      else if ([")", "]", "}"].includes(value)) depth = Math.max(0, depth - 1);
      else if (value === "," && depth === 0) {
        flush(index);
        segmentStart = index + 1;
      } else if (value === ";" && depth === 0) {
        flush(index);
        return { members, end: index + 1 };
      }
      index += 1;
    }
    flush(end);
    return { members, end };
  }

  private parseMembers(typePath: string, start: number, end: number, isInterface: boolean): void {
    const tokens = this.context.lexed.tokens;
    let index = start;
    let annotations: JavaAnnotation[] = [];
    while (index < end) {
      const token = tokens[index] as Token;
      /* v8 ignore next */
      if (token.value === ";" || token.value === "}") {
        index += 1;
        continue;
      }
      if (token.value === "@" && (tokens[index + 1] as Token | undefined)?.value === "interface") {
        index = this.parseType(index + 1, `${typePath}.`, annotations, true);
        annotations = [];
        continue;
      }
      if (token.value === "@") {
        const annotation = this.annotationAt(index);
        if (annotation.name) annotations.push(annotation);
        index = Math.min(annotation.end, end);
        continue;
      }
      if (token.value === "class" || token.value === "interface" || token.value === "enum" || token.value === "record") {
        index = this.parseType(index, `${typePath}.`, annotations);
        annotations = [];
        continue;
      }
      let cursor = index;
      let visibility = isInterface ? "public" : "package";
      let isStatic = false;
      let isFinal = false;
      while (cursor < end && MODIFIERS.has((tokens[cursor] as Token).value)) {
        const modifier = (tokens[cursor] as Token).value;
        if (modifier === "public" || modifier === "protected" || modifier === "private") {
          visibility = modifier;
        } else if (modifier === "static") {
          isStatic = true;
        } else if (modifier === "final") {
          isFinal = true;
        }
        cursor += 1;
      }
      if ((tokens[cursor] as Token | undefined)?.value === "@" &&
        (tokens[cursor + 1] as Token | undefined)?.value === "interface") {
        index = this.parseType(cursor + 1, `${typePath}.`, annotations, true);
        annotations = [];
        continue;
      }
      if (cursor < end && ["class", "interface", "enum", "record"].includes((tokens[cursor] as Token).value)) {
        index = this.parseType(cursor, `${typePath}.`, annotations);
        annotations = [];
        continue;
      }
      let scan = cursor;
      let depth = 0;
      let boundary = -1;
      let paren = -1;
      while (scan < end) {
        const value = (tokens[scan] as Token).value;
        if (value === "<" && (tokens[scan + 1] as Token | undefined)?.value === "<") {
          scan += 2;
          continue;
        }
        if (["<", "[", "{"].includes(value)) depth += 1;
        else if ([">", "]"].includes(value)) depth = Math.max(0, depth - 1);
        else if (value === ";" && depth === 0) {
          boundary = scan;
          break;
        } else if (value === "(" && depth === 0) {
          paren = scan;
          break;
        }
        scan += 1;
      }
      if (paren >= 0) {
        index = this.parseMethod(typePath, index, cursor, paren, end, visibility, annotations);
        annotations = [];
        continue;
      }
      /* v8 ignore next */
      if (boundary < 0) break;
      /* v8 ignore next */
      if ((tokens[boundary] as Token).value === ";") {
        this.parseField(typePath, cursor, boundary, visibility, annotations, isStatic && isFinal);
        annotations = [];
        index = boundary + 1;
        continue;
      }
      index = boundary + 1;
    }
  }

  private parseMethod(
    typePath: string,
    start: number,
    bodyStart: number,
    paren: number,
    end: number,
    visibility: string,
    annotations: JavaAnnotation[] = [],
  ): number {
    const tokens = this.context.lexed.tokens;
    const close = findMatching(tokens, paren, "(", ")");
    if (close < 0) {
      this.context.failures += 1;
      return end;
    }
    let nameIndex = paren - 1;
    while (nameIndex >= bodyStart && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = nameIndex >= bodyStart ? (tokens[nameIndex] as Token).value : "";
    if (!name) return close + 1;
    const constructor = name === typePath.split(".").pop();
    const returnTokens = tokens.slice(bodyStart, Math.max(bodyStart, nameIndex));
    const returnType = constructor
      ? (typePath.split(".").pop() as string)
      : returnTokens.map((token) => token.value).join(" ").replace(/\s*<\s*/gu, "<").replace(/\s*>\s*/gu, ">").trim();
    let cursor = close + 1;
    if ((tokens[cursor] as Token | undefined)?.value === "throws") {
      while (cursor < end && !["{", ";"].includes((tokens[cursor] as Token).value)) cursor += 1;
    }
    let defaultValue: string | undefined;
    let defaultParsed: ReturnType<typeof annotationLiteral> | undefined;
    if ((tokens[cursor] as Token | undefined)?.value === "default") {
      const startOffset = (tokens[cursor] as Token).end;
      cursor += 1;
      while (cursor < end && (tokens[cursor] as Token).value !== ";") cursor += 1;
      const endOffset = cursor < end ? (tokens[cursor] as Token).start : (tokens[end - 1] as Token).end;
      defaultValue = this.context.source.slice(startOffset, endOffset).trim();
      defaultParsed = annotationLiteral(defaultValue);
    }
    let body = "";
    if ((tokens[cursor] as Token | undefined)?.value === "{") {
      const bodyClose = findMatching(tokens, cursor, "{", "}");
      /* v8 ignore next */
      body = tokensText(this.context.source, tokens, cursor, bodyClose < 0 ? end : bodyClose + 1);
      /* v8 ignore next */
      cursor = bodyClose < 0 ? end : bodyClose + 1;
    } else if ((tokens[cursor] as Token | undefined)?.value === ";") {
      cursor += 1;
    }
    {
      this.context.drafts.push({
        name,
        kind: "method",
        path: `${typePath}.${name}`,
        parentPath: typePath,
        start: (tokens[nameIndex] as Token).start,
        body,
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(defaultParsed ? { defaultParsed } : {}),
        shape: {
          kind: "method",
          async: false,
          generator: false,
          params: javaParams(tokens, paren + 1, close),
          returnType,
          visibility,
          flags: javaFlags(annotations),
          ...(defaultValue !== undefined && defaultParsed
            ? {
                defaultValue,
                defaultKind: defaultParsed.kind,
                ...(defaultParsed.literal !== undefined ? { defaultLiteral: defaultParsed.literal } : {}),
                ...(defaultParsed.items !== undefined ? { defaultItems: defaultParsed.items } : {}),
              }
            : {}),
          ...(annotations.length > 0 ? { annotations: javaAnnotations(annotations) } : {}),
        },
      });
    }
    return Math.max(cursor, start + 1);
  }

  private parseField(
    typePath: string,
    start: number,
    semicolon: number,
    visibility: string,
    annotations: JavaAnnotation[] = [],
    constant = false,
  ): void {
    const tokens = this.context.lexed.tokens;
    let equals = -1;
    for (let index = start; index < semicolon; index += 1) {
      if ((tokens[index] as Token).value === "=") {
        equals = index;
        break;
      }
    }
    let nameIndex = (equals >= 0 ? equals : semicolon) - 1;
    while (nameIndex >= start && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = nameIndex >= start ? (tokens[nameIndex] as Token).value : "";
    if (!name) return;
    const type = tokens
      .slice(start, Math.max(start, nameIndex))
      .map((token) => token.value)
      .join(" ")
      .replace(/\[\s*\]/gu, "[]")
      .replace(/\s*<\s*/gu, "<")
      .replace(/\s*>\s*/gu, ">")
      .trim();
    if (constant) {
      if (equals >= 0) {
        const initializer = this.context.source
          .slice((tokens[equals] as Token).end, (tokens[semicolon] as Token).start)
          .trim();
        const parsed = annotationLiteral(initializer);
        const evaluated = evaluateArgument({ value: initializer, ...parsed }, this.context.constants);
        if (evaluated !== undefined) {
          const integral = isIntegralType(type);
          const constant = {
            value: evaluated.value,
            integral,
            ...(integral ? { width: integralWidth(type) } : {}),
          };
          this.context.constants.set(name, constant);
          this.context.constants.set(`${typePath}.${name}`, constant);
        }
      }
    }
    this.context.drafts.push({
      name,
      kind: "property",
      path: `${typePath}.${name}`,
      parentPath: typePath,
      start: (tokens[nameIndex] as Token).start,
      body: "",
      shape: {
        kind: "property",
        typeShape: type,
        visibility,
        flags: javaFlags(annotations),
        ...(annotations.length > 0 ? { annotations: javaAnnotations(annotations) } : {}),
      },
    });
  }
}

function collectJavadocs(
  source: string,
  types: Array<{ name: string; start: number; end: number }>,
): DocstringEntry[] {
  const entries: DocstringEntry[] = [];
  for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\//gu)) {
    const text = match[1] as string;
    const offset = match.index as number;
    const containing = types
      .filter((type) => offset >= type.start && offset < type.end)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start));
    const following = types
      .filter((type) => type.start > offset)
      .sort((left, right) => left.start - right.start)[0];
    const gap = following ? source.slice(offset + match[0].length, following.start) : "";
    const attaches = Boolean(
      following && /^[\s]*(?:(?:public|protected|private|abstract|static|final|sealed|non-sealed|strictfp)\s+)*$/u.test(gap),
    );
    const owner = attaches ? following?.name : (containing[0]?.name ?? following?.name);
    entries.push({
      filePath: "",
      ...(owner ? { owner } : {}),
      line: lineOf(source, offset),
      text: text
        .split(/\r?\n/u)
        .map((line) => line.replace(/^\s*\*\s?/u, ""))
        .join("\n"),
    });
  }
  return entries;
}

export function extractJava(root: string, files: string[], evaluateDefaults = false): ExtractResult {
  const symbols: Symbol[] = [];
  const javadocs: DocstringEntry[] = [];
  let parseFailures = 0;
  let filesScanned = 0;
  const parsedContexts: JavaContext[] = [];
  for (const rel of files) {
    let source: string;
    try {
      source = readFileSync(join(root, rel), "utf8");
    } catch {
      parseFailures += 1;
      continue;
    }
    filesScanned += 1;
    const lexed = lex(source, "java");
    if (lexed.error) parseFailures += 1;
    const packageInfo = findPackageRoot(root, rel);
    const context: JavaContext = {
      source,
      lexed,
      filePath: rel.replace(/\\/gu, "/"),
      packageName: packageInfo.name,
      packageRoot: packageInfo.root,
      modulePath: modulePathFor(packageInfo.root, join(root, rel)),
      packageClause: "",
      drafts: [],
      types: [],
      constants: new Map(),
      evaluateDefaults,
      failures: 0,
    };
    new JavaParser(context).parse();
    parseFailures += context.failures;
    parsedContexts.push(context);
  }

  const constants = new Map<string, EvaluatedConstant>();
  for (const context of parsedContexts) {
    for (const [key, value] of context.constants) constants.set(key, value);
  }
  const enumLabels = new Set<string>();
  for (const context of parsedContexts) {
    for (const draft of context.drafts) {
      if (draft.kind !== "enum") continue;
      for (const member of draft.shape.enumMembers ?? []) {
        enumLabels.add(`${draft.name}.${member.name}`);
      }
    }
  }

  for (const context of parsedContexts) {
    const moduleDotted = context.modulePath.replace(/\//gu, ".");
    const byPath = new Map(
      context.drafts
        .filter(
          (draft) =>
            draft.kind === "class" ||
            draft.kind === "interface" ||
            draft.kind === "enum" ||
            draft.kind === "enumMember",
        )
        .map((draft) => [draft.path, draft]),
    );
    for (const draft of context.drafts) {
      if (evaluateDefaults && draft.defaultValue !== undefined && draft.defaultParsed) {
        const evaluated = evaluateArgument(
          { value: draft.defaultValue, ...draft.defaultParsed },
          constants,
          enumLabels,
        );
        if (evaluated !== undefined) draft.shape.evaluatedDefault = evaluated.value;
      }
      const shapeText = canonicalShape(draft.shape);
      const parent = draft.parentPath ? byPath.get(draft.parentPath) : undefined;
      /* v8 ignore next */
      if (draft.parentPath && !parent) continue;
      const qualified = `${context.packageName}.${moduleDotted}.${draft.path}`;
      const aliases = new Set<string>([draft.name, draft.path]);
      const segments = draft.path.split(".");
      const hasHash = draft.kind === "method" || draft.kind === "property" || draft.kind === "enumMember";
      if (hasHash) aliases.add(draft.path.replace(/\.([^.]+)$/u, "#$1"));
      if (context.packageClause) {
        aliases.add(`${context.packageClause}.${draft.path}`);
        if (hasHash) aliases.add(`${context.packageClause}.${draft.path.replace(/\.([^.]+)$/u, "#$1")}`);
      }
      for (let index = 1; index < segments.length; index += 1) {
        const suffix = segments.slice(index).join(".");
        aliases.add(suffix);
        if (hasHash) aliases.add(suffix.replace(/\.([^.]+)$/u, "#$1"));
        if (context.packageClause) {
          aliases.add(`${context.packageClause}.${suffix}`);
          if (hasHash) aliases.add(`${context.packageClause}.${suffix.replace(/\.([^.]+)$/u, "#$1")}`);
        }
      }
      aliases.add(`${moduleDotted}.${draft.path}`);
      symbols.push({
        id: `${context.packageName}|${context.modulePath}|${draft.kind}|${draft.path}|0`,
        name: draft.name,
        kind: draft.kind,
        modulePath: context.modulePath,
        packageName: context.packageName,
        packageRoot: context.packageRoot,
        qualifiedName: qualified,
        aliases: [...aliases].sort(),
        shape: draft.shape,
        shapeText,
        shapeHash: shapeHash(draft.shape),
        paramNamesHash: paramNamesHash(draft.shape.params),
        bodyHash: bodyHash(draft.body),
        contractFlags: draft.shape.flags as ContractFlag[],
        ...(parent ? { parentId: `${context.packageName}|${context.modulePath}|${parent.kind}|${parent.path}|0` } : {}),
        line: lineOf(context.source, draft.start),
        filePath: context.filePath,
      });
    }
    for (const entry of collectJavadocs(context.source, context.types)) {
      javadocs.push({ ...entry, filePath: context.filePath });
    }
  }
  return { symbols, javadocs, parseFailures, filesScanned };
}
