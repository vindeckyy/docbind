import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot, modulePathFor } from "../discover.js";
import {
  bodyHash,
  canonicalShape,
  paramNamesHash,
  shapeHash,
} from "../shape/canonical.js";
import { normalizeType } from "../hash.js";
import { lex, type LexResult, type Token } from "./lex.js";
import type { ExtractResult } from "./protocol.js";
import { findMatching, lineOf, splitTopLevel, tokenText } from "./syntax.js";
import type {
  ContractFlag,
  EnumMemberShape,
  MemberShape,
  ParamShape,
  Shape,
  Symbol,
  SymbolKind,
} from "../types.js";

interface Draft {
  name: string;
  kind: SymbolKind;
  shape: Shape;
  start: number;
  body: string;
  namespace: string;
  parentName?: string;
  aliases: string[];
  enabled: boolean;
  exported: boolean;
}

interface UseAlias {
  alias: string;
  target: string;
  packageName: string;
}

interface ParserContext {
  source: string;
  lexed: LexResult;
  filePath: string;
  packageName: string;
  packageRoot: string;
  modulePath: string;
  drafts: Draft[];
  aliases: UseAlias[];
  failures: { count: number };
}

function contractFlags(attributes: string[]): ContractFlag[] {
  const text = attributes.join(" ");
  return text.includes("deprecated") ? ["deprecated"] : [];
}

function isHidden(attributes: string[]): boolean {
  const text = attributes.join(" ");
  return text.includes("doc(hidden)") || text.includes("cfg(test)");
}

function genericParams(tokens: Token[], index: number): { text?: string; end: number } {
  if (tokens[index]?.value !== "<") return { end: index };
  const end = findMatching(tokens, index, "<", ">");
  if (end < 0) return { end: tokens.length };
  const text = quoteTokens(tokens, index + 1, end);
  return { text: text.length > 0 ? text : undefined, end: end + 1 };
}

function quoteTokens(tokens: Token[], start: number, end: number): string {
  return normalizeType(tokens.slice(start, end).map((token) => token.value).join(" "));
}

function splitTypes(tokens: Token[], start: number, end: number, masked: string): string[] {
  return splitTopLevel(tokens, start, end, ",")
    .map(([from, to]) => tokenText(masked, tokens, from, to))
    .filter(Boolean);
}

function bodyText(source: string, tokens: Token[], openIndex: number, closeIndex: number): string {
  if (openIndex < 0 || closeIndex < 0) return "";
  return source.slice(tokens[openIndex].start, tokens[closeIndex].end);
}

function parseParams(tokens: Token[], start: number, end: number, masked: string): ParamShape[] {
  return splitTopLevel(tokens, start, end, ",").map(([from, to]) => {
    const text = tokenText(masked, tokens, from, to);
    const colon = tokens.slice(from, to).findIndex((token) => token.value === ":");
    if (tokens[from]?.value === "self" || text.startsWith("self:") || text.startsWith("&self") || text.startsWith("&mut self") || text.startsWith("mut self")) {
      return {
        name: "self",
        type: text.replace(/,\s*$/u, ""),
        optional: false,
        rest: false,
        hasDefault: false,
        kind: "receiver",
      };
    }
    if (colon < 0) {
      return { name: text, type: "", optional: false, rest: false, hasDefault: false };
    }
    const name = tokenText(masked, tokens, from, from + colon);
    const type = tokenText(masked, tokens, from + colon + 1, to);
    return { name, type, optional: false, rest: false, hasDefault: false };
  });
}

function skipAttributes(tokens: Token[], index: number): { attributes: string[]; end: number } {
  const attributes: string[] = [];
  let current = index;
  while (tokens[current]?.value === "#" && tokens[current + 1]?.value === "[") {
    const close = findMatching(tokens, current + 1, "[", "]");
    if (close < 0) return { attributes, end: tokens.length };
    attributes.push(quoteTokens(tokens, current + 1, close + 1));
    current = close + 1;
  }
  return { attributes, end: current };
}

class RustParser {
  private readonly tokens: Token[];
  private readonly masked: string;

  constructor(private readonly context: ParserContext) {
    this.tokens = context.lexed.tokens;
    this.masked = context.lexed.masked;
  }

  parseRange(start: number, end: number, namespace: string, enabled: boolean, parentName?: string, implicitPublic = false): void {
    let index = start;
    while (index < end) {
      const attrs = skipAttributes(this.tokens, index);
      index = attrs.end;
      if (index >= end) break;
      let exported = implicitPublic;
      if (this.tokens[index]?.value === "pub") {
        exported = true;
        index += 1;
        if (this.tokens[index]?.value === "(") {
          const close = findMatching(this.tokens, index, "(", ")");
          index = close < 0 ? end : close + 1;
          exported = false;
        }
      }
      const itemEnabled = enabled && !isHidden(attrs.attributes);

      let asyncFlag = false;
      let unsafeFlag = false;
      while (true) {
        const value = this.tokens[index]?.value;
        if (value === "async") {
          asyncFlag = true;
          index += 1;
        } else if (value === "unsafe" || value === "default") {
          unsafeFlag = true;
          index += 1;
        } else if (value === "extern") {
          index += 1;
          if (this.tokens[index]?.value === "\"" || this.tokens[index]?.value === "C") index += 1;
        } else {
          break;
        }
      }

      const keyword = this.tokens[index]?.value;
      if (!keyword) break;
      if (keyword === "const" && this.tokens[index + 1]?.value === "fn") {
        index += 1;
      }
      const kind = this.tokens[index]?.value;
      if (kind === "fn") {
        const result = this.parseFunction(index, namespace, itemEnabled && exported, parentName, asyncFlag, unsafeFlag, attrs.attributes);
        index = result;
      } else if (kind === "struct") {
        index = this.parseStruct(index, namespace, itemEnabled && exported, attrs.attributes);
      } else if (kind === "enum") {
        index = this.parseEnum(index, namespace, itemEnabled && exported, attrs.attributes);
      } else if (kind === "trait") {
        index = this.parseTrait(index, namespace, itemEnabled && exported, attrs.attributes);
      } else if (kind === "type") {
        index = this.parseTypeAlias(index, namespace, itemEnabled && exported, attrs.attributes);
      } else if (kind === "const" || kind === "static") {
        index = this.parseConst(index, namespace, itemEnabled && exported, attrs.attributes);
      } else if (kind === "mod") {
        index = this.parseModule(index, namespace, itemEnabled && exported, attrs.attributes);
      } else if (kind === "impl") {
        index = this.parseImpl(index, namespace, itemEnabled);
      } else if (kind === "use") {
        index = this.parseUse(index, namespace, itemEnabled && exported);
      } else if (kind === "macro_rules" || kind === "macro") {
        index = this.skipMacro(index);
      } else {
        index += 1;
      }
      if (index <= start) index = start + 1;
    }
  }

  private parseFunction(
    index: number,
    namespace: string,
    exported: boolean,
    parentName: string | undefined,
    asyncFlag: boolean,
    unsafeFlag: boolean,
    attributes: string[],
  ): number {
    const nameToken = this.tokens[index + 1];
    if (!nameToken || !/^[A-Za-z_]/u.test(nameToken.value)) return index + 1;
    let cursor = index + 2;
    const generics = genericParams(this.tokens, cursor);
    cursor = generics.end;
    if (this.tokens[cursor]?.value !== "(") return cursor + 1;
    const close = findMatching(this.tokens, cursor, "(", ")");
    if (close < 0) {
      this.context.failures.count += 1;
      return this.tokens.length;
    }
    const params = parseParams(this.tokens, cursor + 1, close, this.masked);
    cursor = close + 1;
    let returnType: string | undefined;
    if (this.tokens[cursor]?.value === "->") {
      const start = cursor + 1;
      let end = start;
      while (end < this.tokens.length) {
        const value = this.tokens[end].value;
        if (value === "{" || value === ";" || value === "where") break;
        end += 1;
      }
      returnType = tokenText(this.masked, this.tokens, start, end) || undefined;
      cursor = end;
    }
    if (this.tokens[cursor]?.value === "where") {
      while (cursor < this.tokens.length && this.tokens[cursor].value !== "{" && this.tokens[cursor].value !== ";") cursor += 1;
    }
    let body = "";
    let next = cursor;
    if (this.tokens[cursor]?.value === "{") {
      const end = findMatching(this.tokens, cursor, "{", "}");
      if (end < 0) {
        this.context.failures.count += 1;
        return this.tokens.length;
      }
      body = bodyText(this.context.source, this.tokens, cursor, end);
      next = end + 1;
    } else if (this.tokens[cursor]?.value === ";") {
      next = cursor + 1;
    }
    const flags: ContractFlag[] = contractFlags(attributes);
    if (asyncFlag) flags.push("async");
    if (unsafeFlag) flags.push("unsafe");
    const shape: Shape = {
      kind: parentName ? "method" : "function",
      async: asyncFlag,
      generator: false,
      typeParams: generics.text,
      params,
      returnType,
      visibility: "public",
      flags,
    };
    this.context.drafts.push({
      name: nameToken.value,
      kind: parentName ? "method" : "function",
      shape,
      start: nameToken.start,
      body,
      namespace,
      parentName,
      aliases: [],
      enabled: exported,
      exported,
    });
    return next;
  }

  private parseStruct(index: number, namespace: string, exported: boolean, attributes: string[]): number {
    const nameToken = this.tokens[index + 1];
    if (!nameToken) return index + 1;
    let cursor = index + 2;
    const generics = genericParams(this.tokens, cursor);
    cursor = generics.end;
    const members: MemberShape[] = [];
    let body = "";
    if (this.tokens[cursor]?.value === "{") {
      const close = findMatching(this.tokens, cursor, "{", "}");
      if (close < 0) {
        this.context.failures.count += 1;
        return this.tokens.length;
      }
      body = bodyText(this.context.source, this.tokens, cursor, close);
      for (const [from, to] of splitTopLevel(this.tokens, cursor + 1, close, ",")) {
        const field = this.parseField(from, to, nameToken.value, namespace, exported);
        if (field) members.push(field);
      }
      cursor = close + 1;
    } else if (this.tokens[cursor]?.value === "(") {
      const close = findMatching(this.tokens, cursor, "(", ")");
      const types = splitTypes(this.tokens, cursor + 1, close, this.masked);
      types.forEach((type, position) => {
        members.push({ name: String(position), kind: "property", optional: false, shape: { kind: "property", typeShape: type } });
      });
      cursor = close < 0 ? this.tokens.length : close + 1;
      if (this.tokens[cursor]?.value === ";") cursor += 1;
    } else if (this.tokens[cursor]?.value === ";") {
      cursor += 1;
    }
    this.context.drafts.push({
      name: nameToken.value,
      kind: "class",
      shape: { kind: "class", typeParams: generics.text, members, flags: contractFlags(attributes) },
      start: nameToken.start,
      body,
      namespace,
      aliases: [],
      enabled: exported,
      exported,
    });
    return cursor;
  }

  private parseField(from: number, to: number, parentName: string, namespace: string, parentExported: boolean): MemberShape | undefined {
    let cursor = from;
    let isPublic = false;
    if (this.tokens[cursor]?.value === "pub") {
      isPublic = true;
      cursor += 1;
      if (this.tokens[cursor]?.value === "(") {
        const close = findMatching(this.tokens, cursor, "(", ")");
        cursor = close < 0 ? to : close + 1;
        isPublic = false;
      }
    }
    const colon = this.tokens.slice(cursor, to).findIndex((token) => token.value === ":");
    if (colon < 0) return undefined;
    const name = tokenText(this.masked, this.tokens, cursor, cursor + colon);
    const type = tokenText(this.masked, this.tokens, cursor + colon + 1, to);
    if (!name) return undefined;
    if (isPublic && parentExported) {
      this.context.drafts.push({
        name,
        kind: "property",
        shape: { kind: "property", typeShape: type, visibility: "public" },
        start: this.tokens[cursor].start,
        body: "",
        namespace,
        parentName,
        aliases: [],
        enabled: true,
        exported: true,
      });
    }
    return { name, kind: "property", optional: false, shape: { kind: "property", typeShape: type, visibility: isPublic ? "public" : "private" } };
  }

  private parseEnum(index: number, namespace: string, exported: boolean, attributes: string[]): number {
    const nameToken = this.tokens[index + 1];
    if (!nameToken) return index + 1;
    let cursor = index + 2;
    const generics = genericParams(this.tokens, cursor);
    cursor = generics.end;
    const members: EnumMemberShape[] = [];
    let body = "";
    if (this.tokens[cursor]?.value === "{") {
      const close = findMatching(this.tokens, cursor, "{", "}");
      if (close < 0) {
        this.context.failures.count += 1;
        return this.tokens.length;
      }
      body = bodyText(this.context.source, this.tokens, cursor, close);
      for (const [from, to] of splitTopLevel(this.tokens, cursor + 1, close, ",")) {
        const name = this.tokens[from]?.value;
        if (!name || !/^[A-Za-z_]/u.test(name)) continue;
        const value = tokenText(this.masked, this.tokens, from + 1, to);
        members.push({ name, value });
      }
      cursor = close + 1;
    }
    this.context.drafts.push({
      name: nameToken.value,
      kind: "enum",
      shape: { kind: "enum", typeParams: generics.text, enumMembers: members, flags: contractFlags(attributes) },
      start: nameToken.start,
      body,
      namespace,
      aliases: [],
      enabled: exported,
      exported,
    });
    return cursor;
  }

  private parseTrait(index: number, namespace: string, exported: boolean, attributes: string[]): number {
    const nameToken = this.tokens[index + 1];
    if (!nameToken) return index + 1;
    let cursor = index + 2;
    const generics = genericParams(this.tokens, cursor);
    cursor = generics.end;
    let extendsTypes: string[] = [];
    if (this.tokens[cursor]?.value === ":") {
      const start = cursor + 1;
      while (cursor < this.tokens.length && this.tokens[cursor].value !== "{") cursor += 1;
      extendsTypes = this.masked.slice(this.tokens[start]?.start ?? 0, this.tokens[cursor - 1]?.end ?? 0)
        .split("+")
        .map((value) => normalizeType(value))
        .filter(Boolean);
    }
    let members: MemberShape[] = [];
    let body = "";
    if (this.tokens[cursor]?.value === "{") {
      const close = findMatching(this.tokens, cursor, "{", "}");
      if (close < 0) {
        this.context.failures.count += 1;
        return this.tokens.length;
      }
      body = bodyText(this.context.source, this.tokens, cursor, close);
      const before = this.context.drafts.length;
      this.parseRange(cursor + 1, close, namespace, exported, nameToken.value, true);
      members = this.context.drafts.slice(before)
        .filter((draft) => draft.parentName === nameToken.value)
        .map((draft) => ({
          name: draft.name,
          kind: draft.kind,
          optional: false,
          shape: draft.shape,
        }));
      cursor = close + 1;
    }
    this.context.drafts.push({
      name: nameToken.value,
      kind: "interface",
      shape: { kind: "interface", typeParams: generics.text, extends: extendsTypes, members, flags: contractFlags(attributes) },
      start: nameToken.start,
      body,
      namespace,
      aliases: [],
      enabled: exported,
      exported,
    });
    return cursor;
  }

  private parseTypeAlias(index: number, namespace: string, exported: boolean, attributes: string[]): number {
    const nameToken = this.tokens[index + 1];
    if (!nameToken) return index + 1;
    let cursor = index + 2;
    const generics = genericParams(this.tokens, cursor);
    cursor = generics.end;
    const start = this.tokens[cursor]?.value === "=" ? cursor + 1 : cursor;
    while (cursor < this.tokens.length && this.tokens[cursor].value !== ";") cursor += 1;
    const type = tokenText(this.masked, this.tokens, start, cursor);
    this.context.drafts.push({
      name: nameToken.value,
      kind: "type",
      shape: { kind: "type", typeParams: generics.text, typeShape: type, flags: contractFlags(attributes) },
      start: nameToken.start,
      body: type,
      namespace,
      aliases: [],
      enabled: exported,
      exported,
    });
    return cursor + 1;
  }

  private parseConst(index: number, namespace: string, exported: boolean, attributes: string[]): number {
    let nameIndex = index + 1;
    if (this.tokens[nameIndex]?.value === "mut") nameIndex += 1;
    const nameToken = this.tokens[nameIndex];
    if (!nameToken) return index + 1;
    let cursor = nameIndex + 1;
    let type = "";
    if (this.tokens[cursor]?.value === ":") {
      const start = cursor + 1;
      while (cursor < this.tokens.length && this.tokens[cursor].value !== "=" && this.tokens[cursor].value !== ";") cursor += 1;
      type = tokenText(this.masked, this.tokens, start, cursor);
    }
    while (cursor < this.tokens.length && this.tokens[cursor].value !== ";") cursor += 1;
    this.context.drafts.push({
      name: nameToken.value,
      kind: "const",
      shape: { kind: "const", typeShape: type, flags: contractFlags(attributes) },
      start: nameToken.start,
      body: type,
      namespace,
      aliases: [],
      enabled: exported,
      exported,
    });
    return cursor + 1;
  }

  private parseModule(index: number, namespace: string, exported: boolean, attributes: string[]): number {
    const nameToken = this.tokens[index + 1];
    if (!nameToken) return index + 1;
    let cursor = index + 2;
    if (this.tokens[cursor]?.value === "{") {
      const close = findMatching(this.tokens, cursor, "{", "}");
      if (close < 0) {
        this.context.failures.count += 1;
        return this.tokens.length;
      }
      if (exported) {
        this.context.drafts.push({
          name: nameToken.value,
          kind: "module",
          shape: { kind: "module", flags: contractFlags(attributes) },
          start: nameToken.start,
          body: "",
          namespace,
          aliases: [],
          enabled: true,
          exported: true,
        });
      }
      this.parseRange(cursor + 1, close, `${namespace}${nameToken.value}::`, exported);
      return close + 1;
    }
    while (cursor < this.tokens.length && this.tokens[cursor].value !== ";") cursor += 1;
    return cursor + 1;
  }

  private parseImpl(index: number, namespace: string, enabled: boolean): number {
    let cursor = index + 1;
    const generics = genericParams(this.tokens, cursor);
    cursor = generics.end;
    const headerStart = cursor;
    let brace = cursor;
    while (brace < this.tokens.length && this.tokens[brace].value !== "{") brace += 1;
    if (brace >= this.tokens.length) return this.tokens.length;
    const forIndex = this.tokens.slice(headerStart, brace).findIndex((token) => token.value === "for");
    const typeStart = forIndex >= 0 ? headerStart + forIndex + 1 : headerStart;
    let target: string | undefined;
    let firstAngle = -1;
    for (let scan = typeStart; scan < brace; scan += 1) {
      if (this.tokens[scan].value === "<") {
        firstAngle = scan;
        break;
      }
    }
    if (firstAngle >= 0) {
      for (let scan = firstAngle - 1; scan >= typeStart; scan -= 1) {
        if (/^[A-Za-z_]/u.test(this.tokens[scan].value)) {
          target = this.tokens[scan].value;
          break;
        }
      }
    } else {
      for (let scan = typeStart; scan < brace; scan += 1) {
        const value = this.tokens[scan].value;
        if (/^[A-Za-z_]/u.test(value) && !["where", "impl", "for"].includes(value)) target = value;
      }
    }
    const close = findMatching(this.tokens, brace, "{", "}");
    if (close < 0) {
      this.context.failures.count += 1;
      return this.tokens.length;
    }
    if (enabled && target) {
      this.parseRange(brace + 1, close, namespace, true, target, forIndex >= 0);
    }
    return close + 1;
  }

  private parseUse(index: number, namespace: string, enabled: boolean): number {
    let cursor = index + 1;
    const start = cursor;
    let alias: string | undefined;
    let aliasAt = -1;
    while (cursor < this.tokens.length && this.tokens[cursor].value !== ";") {
      if (this.tokens[cursor].value === "as") {
        alias = this.tokens[cursor + 1]?.value;
        aliasAt = cursor;
      }
      if (this.tokens[cursor].value === "{") {
        const close = findMatching(this.tokens, cursor, "{", "}");
        if (close < 0) return this.tokens.length;
        if (enabled) {
          for (const [from, to] of splitTopLevel(this.tokens, cursor + 1, close, ",")) {
            const values = this.tokens.slice(from, to).map((token) => token.value);
            if (values.length < 2) continue;
            const asIndex = values.indexOf("as");
            const target = asIndex > 0 ? values[asIndex - 1] : values[values.length - 1];
            const alias = asIndex > 0 ? values[asIndex + 1] : target;
            if (target && alias && target !== "*" && alias !== "*") {
              this.context.aliases.push({ alias, target, packageName: this.context.packageName });
            }
          }
        }
        return close + 1;
      }
      cursor += 1;
    }
    if (enabled && alias) {
      const names = this.tokens
        .slice(start, aliasAt >= 0 ? aliasAt : cursor)
        .filter((token) => /^[A-Za-z_]/u.test(token.value));
      const target = names[names.length - 1]?.value;
      if (target && target !== alias) {
        this.context.aliases.push({ alias, target, packageName: this.context.packageName });
      }
    }
    return cursor + 1;
  }

  private skipBraces(index: number): number {
    const close = findMatching(this.tokens, index, "{", "}");
    return close < 0 ? this.tokens.length : close + 1;
  }

  private skipMacro(index: number): number {
    let cursor = index + 1;
    while (cursor < this.tokens.length && this.tokens[cursor].value !== "{" && this.tokens[cursor].value !== ";") cursor += 1;
    if (this.tokens[cursor]?.value === "{") return this.skipBraces(cursor);
    return cursor + 1;
  }
}

function buildSymbols(context: ParserContext): Symbol[] {
  const top = context.drafts.filter((draft) => draft.enabled && draft.exported && !draft.parentName);
  const result: Symbol[] = [];
  const byKey = new Map<string, Symbol>();
  const childCounts = new Map<string, number>();
  for (const draft of top) {
    const shapeText = canonicalShape(draft.shape);
    const qualified = `${context.packageName}.${context.modulePath.replace(/\//gu, ".")}.${draft.namespace.replace(/::/gu, ".")}${draft.name}`;
    const symbol: Symbol = {
      id: `${context.packageName}|${context.modulePath}|${draft.kind}|${draft.namespace}${draft.name}|0`,
      name: draft.name,
      kind: draft.kind,
      modulePath: context.modulePath,
      packageName: context.packageName,
      packageRoot: context.packageRoot,
      qualifiedName: qualified,
      aliases: [
        `${context.modulePath.replace(/\//gu, ".")}.${draft.namespace.replace(/::/gu, ".")}${draft.name}`,
      ],
      shape: draft.shape,
      shapeText,
      shapeHash: shapeHash(draft.shape),
      paramNamesHash: paramNamesHash(draft.shape.params),
      bodyHash: bodyHash(draft.body),
      contractFlags: draft.shape.flags ?? [],
      line: lineOf(context.source, draft.start),
      filePath: context.filePath,
    };
    result.push(symbol);
    byKey.set(`${draft.namespace}${draft.name}`, symbol);
  }
  for (const draft of context.drafts) {
    if (!draft.enabled || !draft.exported || !draft.parentName) continue;
    const parent = byKey.get(`${draft.namespace}${draft.parentName}`);
    if (!parent) continue;
    const key = `${draft.namespace}${draft.parentName}.${draft.name}`;
    const index = childCounts.get(key) ?? 0;
    childCounts.set(key, index + 1);
    const shapeText = canonicalShape(draft.shape);
    const symbol: Symbol = {
      id: `${context.packageName}|${context.modulePath}|${draft.kind}|${draft.parentName}.${draft.name}|${index}`,
      name: draft.name,
      kind: draft.kind,
      modulePath: context.modulePath,
      packageName: context.packageName,
      packageRoot: context.packageRoot,
      qualifiedName: `${parent.qualifiedName}.${draft.name}`,
      aliases: [`${draft.parentName}.${draft.name}`],
      shape: draft.shape,
      shapeText,
      shapeHash: shapeHash(draft.shape),
      paramNamesHash: paramNamesHash(draft.shape.params),
      bodyHash: bodyHash(draft.body),
      contractFlags: draft.shape.flags ?? [],
      parentId: parent.id,
      line: lineOf(context.source, draft.start),
      filePath: context.filePath,
    };
    result.push(symbol);
  }
  for (const alias of context.aliases) {
    const targets = result.filter((symbol) => symbol.name === alias.target);
    for (const symbol of targets) {
      if (!symbol.aliases.includes(alias.alias)) symbol.aliases.push(alias.alias);
    }
  }
  return result;
}

export function extractRust(root: string, files: string[]): ExtractResult {
  const symbols: Symbol[] = [];
  const globalAliases: UseAlias[] = [];
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
    const packageInfo = findPackageRoot(root, rel);
    const lexed = lex(source, "rust");
    if (lexed.error) parseFailures += 1;
    const context: ParserContext = {
      source,
      lexed,
      filePath: rel.replace(/\\/gu, "/"),
      packageName: packageInfo.name,
      packageRoot: packageInfo.root,
      modulePath: modulePathFor(packageInfo.root, join(root, rel)),
      drafts: [],
      aliases: [],
      failures: { count: 0 },
    };
    const parser = new RustParser(context);
    parser.parseRange(0, lexed.tokens.length, "", true);
    parseFailures += context.failures.count;
    globalAliases.push(...context.aliases);
    symbols.push(...buildSymbols(context));
    filesScanned += 1;
  }
  for (const alias of globalAliases) {
    for (const symbol of symbols) {
      if (symbol.packageName === alias.packageName && symbol.name === alias.target && !symbol.aliases.includes(alias.alias)) {
        symbol.aliases.push(alias.alias);
      }
    }
  }
  return { symbols, parseFailures, filesScanned };
}

export interface RustSignatureSnippet {
  name: string;
  kind: SymbolKind;
  shape: Shape;
}

export function snippetSignatureRust(code: string): RustSignatureSnippet | undefined {
  const lexed = lex(code, "rust");
  const context: ParserContext = {
    source: code,
    lexed,
    filePath: "snippet.rs",
    packageName: "snippet",
    packageRoot: "",
    modulePath: "snippet",
    drafts: [],
    aliases: [],
    failures: { count: 0 },
  };
  new RustParser(context).parseRange(0, lexed.tokens.length, "", true);
  const draft = context.drafts.find((candidate) =>
    !candidate.parentName &&
    candidate.body.length === 0 &&
    candidate.kind !== "const" &&
    candidate.kind !== "module"
  );
  if (!draft) return undefined;
  const method = (draft.shape.params ?? []).some((param) => param.kind === "receiver");
  return {
    name: draft.name,
    kind: method ? "method" : draft.kind,
    shape: { ...draft.shape, kind: method ? "method" : draft.shape.kind },
  };
}
