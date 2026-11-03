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

interface MacroRule {
  matcher: Token[];
  body: Token[];
}

interface MacroMatch {
  single: Map<string, Token[]>;
  repeated: Map<string, Token[][]>;
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

function procMacroDeriveNames(attributes: string[]): string[] {
  const names: string[] = [];
  for (const attribute of attributes) {
    const match = /proc_macro_derive\s*\(\s*([A-Za-z_]\w*)/u.exec(attribute);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

function derivedTraits(attributes: string[]): Set<string> {
  const traits = new Set<string>();
  for (const attribute of attributes) {
    const match = /derive\s*\(([^)]+)\)/u.exec(attribute);
    if (!match?.[1]) continue;
    for (const name of match[1].split(",")) {
      /* v8 ignore next */
      const cleaned = name.trim().split("::").pop() ?? "";
      if (cleaned) traits.add(cleaned);
    }
  }
  return traits;
}

interface DerivedMethod {
  name: string;
  params: ParamShape[];
  returnType: string;
}

function derivedMethods(attributes: string[]): DerivedMethod[] {
  const traits = derivedTraits(attributes);
  const methods: DerivedMethod[] = [];
  const receiver = (type = "&self"): ParamShape => ({
    name: "self",
    type,
    optional: false,
    rest: false,
    hasDefault: false,
    kind: "receiver",
  });
  const other = { name: "other", type: "&Self", optional: false, rest: false, hasDefault: false };
  if (traits.has("Clone")) {
    methods.push({ name: "clone", params: [receiver()], returnType: "Self" });
    methods.push({ name: "clone_from", params: [receiver("&mut self"), { ...other, name: "source" }], returnType: "()" });
  }
  if (traits.has("Default")) methods.push({ name: "default", params: [], returnType: "Self" });
  if (traits.has("Debug")) {
    methods.push({ name: "fmt", params: [receiver(), { ...other, name: "formatter", type: "&mut Formatter" }], returnType: "Result" });
  }
  if (traits.has("PartialEq")) {
    methods.push({ name: "eq", params: [receiver(), other], returnType: "bool" });
    methods.push({ name: "ne", params: [receiver(), other], returnType: "bool" });
  }
  if (traits.has("PartialOrd")) {
    methods.push({ name: "partial_cmp", params: [receiver(), other], returnType: "Option<Ordering>" });
    for (const name of ["lt", "le", "gt", "ge"]) {
      methods.push({ name, params: [receiver(), other], returnType: "bool" });
    }
  }
  if (traits.has("Ord")) methods.push({ name: "cmp", params: [receiver(), other], returnType: "Ordering" });
  if (traits.has("Hash")) {
    methods.push({ name: "hash", params: [receiver(), { ...other, name: "state", type: "&mut H" }], returnType: "()" });
  }
  return methods;
}

function addDerivedMethods(
  context: ParserContext,
  name: string,
  start: number,
  namespace: string,
  exported: boolean,
  attributes: string[],
): void {
  if (!exported) return;
  for (const method of derivedMethods(attributes)) {
    context.drafts.push({
      name: method.name,
      kind: "method",
      shape: {
        kind: "method",
        async: false,
        generator: false,
        params: method.params,
        returnType: method.returnType,
        visibility: "public",
        flags: [],
      },
      start,
      body: `derive:${method.name}`,
      namespace,
      parentName: name,
      aliases: [],
      enabled: true,
      exported: true,
    });
  }
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
  /* v8 ignore next */
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
  private readonly macros = new Map<string, MacroRule[]>();
  private macroDepth = 0;

  constructor(
    private readonly context: ParserContext,
    private readonly externalMacros: Map<string, MacroRule[]> = new Map(),
  ) {
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
      if (kind === "macro_rules") {
        index = this.parseMacroDefinition(index, enabled, attrs.attributes);
        continue;
      }
      const invocation = this.macroInvocationAt(index);
      if (invocation) {
        index = this.expandMacro(invocation.bang, invocation.name, namespace, itemEnabled, parentName, implicitPublic);
        continue;
      }
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
      } else if (kind === "macro") {
        index = this.skipMacro(index);
      } else {
        index += 1;
      }
      /* v8 ignore next */
      if (index <= start) index = start + 1;
    }
  }

  private parseMacroDefinition(index: number, enabled: boolean, attributes: string[]): number {
    let cursor = index + 1;
    if (this.tokens[cursor]?.value === "!") cursor += 1;
    const name = this.tokens[cursor]?.value;
    cursor += 1;
    if (!name || this.tokens[cursor]?.value !== "{") return cursor + 1;
    const close = findMatching(this.tokens, cursor, "{", "}");
    if (close < 0) {
      this.context.failures.count += 1;
      return this.tokens.length;
    }
    if (enabled) {
      const rules = this.parseMacroRules(cursor + 1, close);
      this.macros.set(name, rules);
      if (attributes.some((attribute) => attribute.includes("macro_export"))) {
        this.externalMacros.set(name, rules);
      }
    }
    return close + 1;
  }

  private macroInvocationAt(index: number): { name: string; bang: number } | undefined {
    /* v8 ignore next */
    if (!/^[A-Za-z_]/u.test(this.tokens[index]?.value ?? "")) return undefined;
    let cursor = index;
    let name = this.tokens[cursor].value;
    while (
      (this.tokens[cursor + 1]?.value === "::" || this.tokens[cursor + 1]?.value === ".") &&
      /^[A-Za-z_]/u.test(this.tokens[cursor + 2]?.value ?? "")
    ) {
      name = this.tokens[cursor + 2].value;
      cursor += 2;
    }
    /* v8 ignore next */
    /* v8 ignore next */
    if (this.tokens[cursor + 1]?.value !== "!") return undefined;
    if (!this.macros.has(name) && !this.externalMacros.has(name)) return undefined;
    return { name, bang: cursor + 1 };
  }

  private parseMacroRules(start: number, end: number): MacroRule[] {
    const rules: MacroRule[] = [];
    let cursor = start;
    while (cursor < end) {
      if (this.tokens[cursor]?.value === ";") {
        cursor += 1;
        continue;
      }
      const open = this.tokens[cursor]?.value;
      /* v8 ignore next */
      if (!open || !["(", "[", "{"].includes(open)) {
        cursor += 1;
        continue;
      }
      const close = findMatching(this.tokens, cursor, open, open === "(" ? ")" : open === "[" ? "]" : "}");
      if (close < 0) break;
      if (this.tokens[close + 1]?.value !== "=>") {
        cursor = close + 1;
        continue;
      }
      const bodyOpen = this.tokens[close + 2]?.value;
      if (!bodyOpen || !["(", "[", "{"].includes(bodyOpen)) {
        cursor = close + 3;
        continue;
      }
      const bodyClose = findMatching(
        this.tokens,
        close + 2,
        bodyOpen,
        bodyOpen === "(" ? ")" : bodyOpen === "[" ? "]" : "}",
      );
      /* v8 ignore next */
      if (bodyClose < 0) break;
      rules.push({
        matcher: this.tokens.slice(cursor + 1, close),
        body: this.tokens.slice(close + 3, bodyClose),
      });
      cursor = bodyClose + 1;
    }
    return rules;
  }

  private matchMacroRule(matcher: Token[], args: Token[]): MacroMatch | undefined {
    const single = new Map<string, Token[]>();
    const repeated = new Map<string, Token[][]>();
    let matcherIndex = 0;
    let argIndex = 0;
    while (matcherIndex < matcher.length) {
      if (matcher[matcherIndex]?.value === "$" && matcher[matcherIndex + 1]?.value === "(") {
        const close = findMatching(matcher, matcherIndex + 1, "(", ")");
        /* v8 ignore next */
        if (close < 0) return undefined;
        let after = close + 1;
        let separator: string | undefined;
        if (matcher[after]?.value === "," || matcher[after]?.value === ";") {
          separator = matcher[after].value;
          after += 1;
        }
        const operation = matcher[after]?.value;
        if (operation !== "*" && operation !== "+") return undefined;
        const inner = matcher.slice(matcherIndex + 2, close);
        const ranges = separator
          ? splitTopLevel(args, argIndex, args.length, separator)
          : args.slice(argIndex).map((_, offset) => [argIndex + offset, argIndex + offset + 1] as [number, number]);
        if (operation === "+" && ranges.length === 0) return undefined;
        const collected = new Map<string, Token[][]>();
        for (const [from, to] of ranges) {
          const child = this.matchMacroRule(inner, args.slice(from, to));
          if (!child) return undefined;
          for (const [name, values] of child.single) {
            const list = collected.get(name) ?? [];
            list.push(values);
            collected.set(name, list);
          }
          for (const [name, values] of child.repeated) {
            const list = repeated.get(name) ?? [];
            list.push(...values);
            repeated.set(name, list);
          }
        }
        for (const [name, values] of collected) {
          const list = repeated.get(name) ?? [];
          list.push(...values);
          repeated.set(name, list);
        }
        argIndex = args.length;
        matcherIndex = after + 1;
        continue;
      }
      if (
        matcher[matcherIndex]?.value === "$" &&
        matcher[matcherIndex + 1] &&
        matcher[matcherIndex + 2]?.value === ":"
      ) {
        const name = matcher[matcherIndex + 1].value;
        const kind = matcher[matcherIndex + 3]?.value;
        matcherIndex += 4;
        if (kind === "vis") {
          const start = argIndex;
          if (args[argIndex]?.value === "pub") {
            argIndex += 1;
            if (args[argIndex]?.value === "(") {
              const close = findMatching(args, argIndex, "(", ")");
              argIndex = close < 0 ? args.length : close + 1;
            }
          }
          single.set(name, args.slice(start, argIndex));
          continue;
        }
        if (kind === "ident") {
          const token = args[argIndex];
          if (!token || !/^[A-Za-z_]/u.test(token.value)) return undefined;
          single.set(name, [token]);
          argIndex += 1;
          continue;
        }
        if (kind === "tt") {
          const token = args[argIndex];
          if (!token) return undefined;
          single.set(name, [token]);
          argIndex += 1;
          continue;
        }
        if (kind === "ty") {
          single.set(name, args.slice(argIndex));
          argIndex = args.length;
          continue;
        }
        return undefined;
      }
      const expected = matcher[matcherIndex];
      const actual = args[argIndex];
      if (!expected || !actual || expected.value !== actual.value) return undefined;
      matcherIndex += 1;
      argIndex += 1;
    }
    if (argIndex !== args.length) return undefined;
    return { single, repeated };
  }

  private expandTemplate(
    tokens: Token[],
    match: MacroMatch,
    overrides = new Map<string, Token[]>(),
    depth = 0,
  ): Token[] | undefined {
    /* v8 ignore next */
    if (depth > 8) return tokens;
    const result: Token[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.value === "$" && tokens[index + 1]?.value === "(") {
        const close = findMatching(tokens, index + 1, "(", ")");
        /* v8 ignore next 3 */
        if (close < 0) {
          result.push(token);
          continue;
        }
        let after = close + 1;
        let separator: Token | undefined;
        if (tokens[after]?.value === "," || tokens[after]?.value === ";") {
          separator = tokens[after];
          after += 1;
        }
        const operation = tokens[after]?.value;
        if (operation === "*" || operation === "+") {
          const inner = tokens.slice(index + 2, close);
          const bound = [...match.repeated.keys()].filter((name) =>
            inner.some((candidate, offset) => candidate.value === "$" && inner[offset + 1]?.value === name)
          );
          const names = bound.filter((name) => !overrides.has(name));
          const overridden = bound.filter((name) => overrides.has(name));
          if (names.length === 0 && overridden.length > 0) {
            const expanded = this.expandTemplate(inner, match, overrides, depth + 1);
            if (!expanded) return undefined;
            result.push(...expanded);
            index = after;
            continue;
          }
          const count = names.length === 0
            ? 0
            : Math.max(...names.map((name) => match.repeated.get(name)?.length ?? 0));
          for (let repetition = 0; repetition < count; repetition += 1) {
            const local = new Map(overrides);
            for (const name of names) local.set(name, match.repeated.get(name)?.[repetition] ?? []);
            const expanded = this.expandTemplate(inner, match, local, depth + 1);
            if (!expanded) return undefined;
            result.push(...expanded);
            if (separator && repetition < count - 1) result.push(separator);
          }
          index = after;
          continue;
        }
        if (operation === "?" ) return undefined;
      }
      if (token.value === "$" && tokens[index + 1]) {
        const name = tokens[index + 1].value;
        const values = overrides.get(name) ?? match.single.get(name);
        if (values) {
          result.push(...values);
          index += 1;
          continue;
        }
      }
      result.push(token);
    }
    return result;
  }

  private expandMacro(
    bang: number,
    name: string,
    namespace: string,
    enabled: boolean,
    parentName: string | undefined,
    implicitPublic: boolean,
  ): number {
    const open = this.tokens[bang + 1];
    if (!open || !["(", "[", "{"].includes(open.value)) return bang + 1;
    const close = findMatching(this.tokens, bang + 1, open.value, open.value === "(" ? ")" : open.value === "[" ? "]" : "}");
    /* v8 ignore next */
    if (close < 0 || this.macroDepth >= 4) return close < 0 ? this.tokens.length : close + 1;
    const args = this.tokens.slice(bang + 2, close);
    /* v8 ignore next */
    const rules = this.macros.get(name) ?? this.externalMacros.get(name) ?? [];
    for (const rule of rules) {
      const captured = this.matchMacroRule(rule.matcher, args);
      if (!captured) continue;
      const generated = this.expandTemplate(rule.body, captured);
      if (!generated) return close + 1;
      const source = generated.map((token) => token.value).join(" ");
      const childLexed = lex(source, "rust");
      const childContext: ParserContext = {
        source,
        lexed: childLexed,
        filePath: this.context.filePath,
        packageName: this.context.packageName,
        packageRoot: this.context.packageRoot,
        modulePath: this.context.modulePath,
        drafts: [],
        aliases: [],
        failures: { count: 0 },
      };
      const child = new RustParser(childContext, this.externalMacros);
      for (const [macroName, macroRules] of this.macros.entries()) child.macros.set(macroName, macroRules);
      this.macroDepth += 1;
      child.parseRange(0, childLexed.tokens.length, namespace, enabled, parentName, implicitPublic);
      this.macroDepth -= 1;
      this.context.failures.count += childContext.failures.count;
      for (const draft of childContext.drafts) {
        draft.start = this.tokens[bang].start;
        this.context.drafts.push(draft);
      }
      return close + 1;
    }
    return close + 1;
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
      aliases: procMacroDeriveNames(attributes),
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
    addDerivedMethods(this.context, nameToken.value, nameToken.start, namespace, exported, attributes);
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
    addDerivedMethods(this.context, nameToken.value, nameToken.start, namespace, exported, attributes);
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
      /* v8 ignore next */
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
            /* v8 ignore next 2 */
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

function buildRustTopSymbols(context: ParserContext): Symbol[] {
  const result: Symbol[] = [];
  for (const draft of context.drafts) {
    if (!draft.enabled || !draft.exported || draft.parentName) continue;
    const shapeText = canonicalShape(draft.shape);
    const qualified = `${context.packageName}.${context.modulePath.replace(/\//gu, ".")}.${draft.namespace.replace(/::/gu, ".")}${draft.name}`;
    result.push({
      id: `${context.packageName}|${context.modulePath}|${draft.kind}|${draft.namespace}${draft.name}|0`,
      name: draft.name,
      kind: draft.kind,
      modulePath: context.modulePath,
      packageName: context.packageName,
      packageRoot: context.packageRoot,
      qualifiedName: qualified,
      aliases: [
        `${context.modulePath.replace(/\//gu, ".")}.${draft.namespace.replace(/::/gu, ".")}${draft.name}`,
        `${context.packageName.replace(/-/gu, "_")}.${draft.namespace.replace(/::/gu, ".")}${draft.name}`,
        `${context.packageName.replace(/-/gu, "_")}.${draft.name}`,
        ...draft.aliases,
      ],
      shape: draft.shape,
      shapeText,
      shapeHash: shapeHash(draft.shape),
      paramNamesHash: paramNamesHash(draft.shape.params),
      bodyHash: bodyHash(draft.body),
      contractFlags: draft.shape.flags ?? [],
      line: lineOf(context.source, draft.start),
      filePath: context.filePath,
    });
  }
  return result;
}

function buildRustChildren(context: ParserContext, parents: Map<string, Symbol>): Symbol[] {
  const result: Symbol[] = [];
  const childCounts = new Map<string, number>();
  for (const draft of context.drafts) {
    if (!draft.enabled || !draft.exported || !draft.parentName) continue;
    const parent = parents.get(`${context.packageName}\0${draft.namespace}${draft.parentName}`);
    if (!parent) continue;
    const key = `${draft.namespace}${draft.parentName}.${draft.name}`;
    const index = childCounts.get(key) ?? 0;
    childCounts.set(key, index + 1);
    const shapeText = canonicalShape(draft.shape);
    result.push({
      id: `${parent.packageName}|${parent.modulePath}|${draft.kind}|${draft.parentName}.${draft.name}|${index}`,
      name: draft.name,
      kind: draft.kind,
      modulePath: parent.modulePath,
      packageName: parent.packageName,
      packageRoot: parent.packageRoot,
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
    });
  }
  return result;
}

export function extractRust(root: string, files: string[]): ExtractResult {
  const contexts: ParserContext[] = [];
  const globalAliases: UseAlias[] = [];
  const sources: Array<{
    rel: string;
    source: string;
    lexed: ReturnType<typeof lex>;
    packageInfo: ReturnType<typeof findPackageRoot>;
    modulePath: string;
  }> = [];
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
    sources.push({
      rel: rel.replace(/\\/gu, "/"),
      source,
      lexed,
      packageInfo,
      modulePath: modulePathFor(packageInfo.root, join(root, rel)),
    });
  }

  const exportedMacros = new Map<string, MacroRule[]>();
  for (const source of sources) {
    const context: ParserContext = {
      source: source.source,
      lexed: source.lexed,
      filePath: source.rel,
      packageName: source.packageInfo.name,
      packageRoot: source.packageInfo.root,
      modulePath: source.modulePath,
      drafts: [],
      aliases: [],
      failures: { count: 0 },
    };
    new RustParser(context, exportedMacros).parseRange(0, source.lexed.tokens.length, "", true);
  }

  for (const source of sources) {
    const context: ParserContext = {
      source: source.source,
      lexed: source.lexed,
      filePath: source.rel,
      packageName: source.packageInfo.name,
      packageRoot: source.packageInfo.root,
      modulePath: source.modulePath,
      drafts: [],
      aliases: [],
      failures: { count: 0 },
    };
    const parser = new RustParser(context, exportedMacros);
    parser.parseRange(0, source.lexed.tokens.length, "", true);
    parseFailures += context.failures.count;
    globalAliases.push(...context.aliases);
    contexts.push(context);
    filesScanned += 1;
  }

  const symbols = contexts.flatMap(buildRustTopSymbols);
  const parents = new Map(
    symbols.map((symbol) => [`${symbol.packageName}\0${symbol.name}`, symbol]),
  );
  symbols.push(...contexts.flatMap((context) => buildRustChildren(context, parents)));
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
  if (/derive\s*\(/u.test(code)) return undefined;
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
  /* v8 ignore next */
  const method = (draft.shape.params ?? []).some((param) => param.kind === "receiver");
  return {
    name: draft.name,
    kind: method ? "method" : draft.kind,
    shape: { ...draft.shape, kind: method ? "method" : draft.shape.kind },
  };
}
