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
  if (text.startsWith("\"") && text.endsWith("\"")) {
    try {
      return { kind: "string", literal: JSON.parse(text) as string };
    } catch {
      return { kind: "string", literal: text.slice(1, -1) };
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) {
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
    while (cursor < to && ["@", "final"].includes((tokens[cursor] as Token).value)) {
      cursor += 1;
      while (cursor < to && (tokens[cursor] as Token).value !== " " && (tokens[cursor] as Token).value !== ",") {
        /* v8 ignore next */
        if (/^[A-Za-z_]/u.test((tokens[cursor] as Token).value) && (tokens[cursor + 1] as Token | undefined)?.value === "(") {
          const close = findMatching(tokens, cursor + 1, "(", ")");
          /* v8 ignore next */
          cursor = close < 0 ? to : close + 1;
        } else {
          cursor += 1;
        }
      }
    }
    let nameIndex = to - 1;
    while (nameIndex >= cursor && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    /* v8 ignore next */
    const name = ((tokens[nameIndex] as Token | undefined)?.value ?? "") as string;
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
    if (/^[A-Za-z_]/u.test((tokens[cursor] as Token | undefined)?.value ?? "")) {
      name = (tokens[cursor] as Token).value;
      cursor += 1;
    }
    while (
      (tokens[cursor] as Token | undefined)?.value === "." &&
      /^[A-Za-z_]/u.test((tokens[cursor + 1] as Token | undefined)?.value ?? "")
    ) {
      name = `${name}.${(tokens[cursor + 1] as Token).value}`;
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
      /* v8 ignore next */
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
    /* v8 ignore next */
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
          this.context.drafts.push({
            name: value,
            kind: "enumMember",
            path,
            parentPath: typePath,
            start,
            body: "",
            shape: { kind: "enumMember", flags: [] },
          });
          if ((tokens[cursor] as Token | undefined)?.value === "{") {
            const close = findMatching(tokens, cursor, "{", "}");
            if (close > cursor) {
              this.parseMembers(path, cursor + 1, close, false);
            }
            cursor = close < 0 ? segmentEnd : close + 1;
          }
          members.push({ name: value, value: args ?? "", ...(args ? { args } : {}) });
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
      while (cursor < end && MODIFIERS.has((tokens[cursor] as Token).value)) {
        const modifier = (tokens[cursor] as Token).value;
        if (modifier === "public" || modifier === "protected" || modifier === "private") {
          visibility = modifier;
        }
        cursor += 1;
      }
      if ((tokens[cursor] as Token | undefined)?.value === "@" &&
        (tokens[cursor + 1] as Token | undefined)?.value === "interface") {
        index = this.parseType(cursor + 1, `${typePath}.`, annotations, true);
        annotations = [];
        continue;
      }
      if (["class", "interface", "enum", "record"].includes((tokens[cursor] as Token | undefined)?.value ?? "")) {
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
      if (paren >= 0 && (boundary < 0 || paren < boundary)) {
        index = this.parseMethod(typePath, index, cursor, paren, end, visibility, annotations);
        annotations = [];
        continue;
      }
      /* v8 ignore next */
      if (boundary < 0) break;
      /* v8 ignore next */
      if ((tokens[boundary] as Token).value === ";") {
        this.parseField(typePath, cursor, boundary, visibility, annotations);
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
    /* v8 ignore next */
    if (close < 0) {
      this.context.failures += 1;
      return end;
    }
    let nameIndex = paren - 1;
    while (nameIndex >= bodyStart && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = ((tokens[nameIndex] as Token | undefined)?.value ?? "") as string;
    /* v8 ignore next */
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
    /* v8 ignore next */
    /* v8 ignore next */
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
  ): void {
    const tokens = this.context.lexed.tokens;
    let nameIndex = semicolon - 1;
    while (nameIndex >= start && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = ((tokens[nameIndex] as Token | undefined)?.value ?? "") as string;
    /* v8 ignore next */
    if (!name) return;
    const type = tokens
      .slice(start, Math.max(start, nameIndex))
      .map((token) => token.value)
      .join(" ")
      .replace(/\[\s*\]/gu, "[]")
      .replace(/\s*<\s*/gu, "<")
      .replace(/\s*>\s*/gu, ">")
      .trim();
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

export function extractJava(root: string, files: string[]): ExtractResult {
  const symbols: Symbol[] = [];
  const javadocs: DocstringEntry[] = [];
  let parseFailures = 0;
  let filesScanned = 0;
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
      failures: 0,
    };
    new JavaParser(context).parse();
    parseFailures += context.failures;
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
        line: lineOf(source, draft.start),
        filePath: context.filePath,
      });
    }
    for (const entry of collectJavadocs(source, context.types)) {
      javadocs.push({ ...entry, filePath: context.filePath });
    }
  }
  return { symbols, javadocs, parseFailures, filesScanned };
}
