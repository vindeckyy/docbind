import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { findPackageRoot, modulePathFor } from "../discover.js";
import {
  bodyHash as hashBody,
  canonicalShape,
  flagsFromNames,
  paramNamesHash,
  shapeHash,
} from "../shape/canonical.js";
import { normalizeType } from "../hash.js";
import type {
  ContractFlag,
  EnumMemberShape,
  MemberShape,
  ParamShape,
  Shape,
  Symbol,
  SymbolKind,
} from "../types.js";
import type { ExtractResult } from "./protocol.js";

interface DeclInfo {
  file: ParsedFile;
  name: string;
  kind: SymbolKind;
  node: ts.Node;
  index: number;
}

type ExportRecord =
  | { type: "local"; exported: string; local: string }
  | { type: "reexport"; exported: string; source: string; imported: string }
  | { type: "namespace"; exported: string; source: string }
  | { type: "star"; source: string };

interface ParsedFile {
  rel: string;
  sourceFile: ts.SourceFile;
  packageName: string;
  packageRoot: string;
  modulePath: string;
  decls: DeclInfo[];
  localSymbols: Map<string, Symbol[]>;
  exports: ExportRecord[];
  stars: string[];
  parseFailures: number;
}

const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function hasExport(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasDefault(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function visibilityOf(node: ts.Node): "public" | "private" | "protected" {
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return "private";
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return "protected";
  return "public";
}

function isPrivateMember(node: ts.Node): boolean {
  if (visibilityOf(node) !== "public") return true;
  const name = (node as { name?: ts.Node }).name;
  return Boolean(name && ts.isIdentifier(name) && name.text.startsWith("#"));
}

function flagsOf(node: ts.Node): ContractFlag[] {
  const names: string[] = [];
  if (ts.canHaveModifiers(node)) {
    for (const modifier of ts.getModifiers(node) ?? []) {
      if (modifier.kind === ts.SyntaxKind.StaticKeyword) names.push("static");
      if (modifier.kind === ts.SyntaxKind.ReadonlyKeyword) names.push("readonly");
      if (modifier.kind === ts.SyntaxKind.AbstractKeyword) names.push("abstract");
    }
  }
  if (ts.isFunctionLike(node) && (node as { asteriskToken?: ts.Node }).asteriskToken) names.push("generator");
  if (ts.isFunctionLike(node) && hasModifier(node, ts.SyntaxKind.AsyncKeyword)) names.push("async");
  if (ts.getJSDocTags(node).some((tag) => tag.tagName.text === "deprecated")) {
    names.push("deprecated");
  }
  return [...new Set(flagsFromNames(names))];
}

function textOf(node: ts.Node | undefined): string | undefined {
  return node ? normalizeType(node.getText()) : undefined;
}

function paramsOf(node: ts.SignatureDeclaration): ParamShape[] {
  return node.parameters.map((parameter) => ({
    name: ts.isIdentifier(parameter.name) ? parameter.name.text : parameter.name.getText(),
    type: textOf(parameter.type) ?? "",
    optional: Boolean(parameter.questionToken || parameter.initializer),
    rest: Boolean(parameter.dotDotDotToken),
    hasDefault: Boolean(parameter.initializer),
    kind: "positional",
  }));
}

function typeParamsOf(node: ts.Node): string | undefined {
  const typeParameters = (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
  if (!typeParameters || typeParameters.length === 0) return undefined;
  return typeParameters.map((parameter) => normalizeType(parameter.getText())).join(",");
}

function memberName(member: ts.Node): string | undefined {
  const name = (member as { name?: ts.Node }).name;
  if (!name) {
    if (ts.isConstructorDeclaration(member)) return "constructor";
    if (ts.isIndexSignatureDeclaration(member)) return "[index]";
    if (ts.isCallSignatureDeclaration(member)) return "[call]";
    if (ts.isConstructSignatureDeclaration(member)) return "[construct]";
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function memberShapeOf(member: ts.Node): { name: string; kind: SymbolKind; optional: boolean; shape: Shape } | undefined {
  const name = memberName(member);
  if (!name) return undefined;
  const optional = Boolean((member as { questionToken?: ts.Node }).questionToken);
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member) || ts.isConstructorDeclaration(member)) {
    return {
      name,
      kind: "method",
      optional,
      shape: {
        kind: "method",
        async: ts.isMethodDeclaration(member) ? hasModifier(member, ts.SyntaxKind.AsyncKeyword) : undefined,
        generator: ts.isMethodDeclaration(member) ? Boolean(member.asteriskToken) : undefined,
        typeParams: typeParamsOf(member),
        params: paramsOf(member),
        returnType: textOf(member.type),
        visibility: visibilityOf(member),
        flags: flagsOf(member),
      },
    };
  }
  if (
    ts.isPropertyDeclaration(member) ||
    ts.isPropertySignature(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  ) {
    const type = textOf((member as { type?: ts.TypeNode }).type) ??
      ((member as { initializer?: ts.Expression }).initializer
        ? `literal:${(member as { initializer: ts.Expression }).initializer.kind}`
        : undefined);
    return {
      name,
      kind: "property",
      optional,
      shape: {
        kind: "property",
        typeShape: type,
        visibility: visibilityOf(member),
        flags: flagsOf(member),
      },
    };
  }
  if (ts.isIndexSignatureDeclaration(member)) {
    return {
      name,
      kind: "property",
      optional: false,
      shape: {
        kind: "property",
        typeShape: textOf(member.type),
        params: paramsOf(member),
        flags: flagsOf(member),
      },
    };
  }
  if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
    return {
      name,
      kind: "method",
      optional: false,
      shape: {
        kind: "method",
        typeParams: typeParamsOf(member),
        params: paramsOf(member),
        returnType: textOf(member.type),
        flags: flagsOf(member),
      },
    };
  }
  return undefined;
}

function membersOf(node: ts.Node): MemberShape[] {
  const members = (node as { members?: ts.NodeArray<ts.Node> }).members;
  if (!members) return [];
  const result = new Map<string, MemberShape>();
  for (const member of members) {
    if (isPrivateMember(member)) continue;
    const info = memberShapeOf(member);
    if (!info) continue;
    result.set(info.name, { name: info.name, kind: info.kind, optional: info.optional, shape: info.shape });
  }
  return [...result.values()];
}

function heritageOf(node: ts.Node, token: ts.SyntaxKind): string[] {
  const clauses = (node as { heritageClauses?: ts.NodeArray<ts.HeritageClause> }).heritageClauses;
  if (!clauses) return [];
  return clauses
    .filter((clause) => clause.token === token)
    .flatMap((clause) => clause.types.map((type) => normalizeType(type.getText())));
}

function shapeOfDeclaration(kind: SymbolKind, node: ts.Node): Shape {
  if (ts.isFunctionDeclaration(node)) {
    return {
      kind,
      async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
      generator: Boolean(node.asteriskToken),
      typeParams: typeParamsOf(node),
      params: paramsOf(node),
      returnType: textOf(node.type),
      visibility: "public",
      flags: flagsOf(node),
    };
  }
  if (ts.isClassDeclaration(node)) {
    return {
      kind,
      abstract: hasModifier(node, ts.SyntaxKind.AbstractKeyword),
      typeParams: typeParamsOf(node),
      extends: heritageOf(node, ts.SyntaxKind.ExtendsKeyword),
      implements: heritageOf(node, ts.SyntaxKind.ImplementsKeyword),
      members: membersOf(node),
      flags: flagsOf(node),
    };
  }
  if (ts.isInterfaceDeclaration(node)) {
    return {
      kind,
      typeParams: typeParamsOf(node),
      extends: heritageOf(node, ts.SyntaxKind.ExtendsKeyword),
      members: membersOf(node),
      flags: flagsOf(node),
    };
  }
  if (ts.isTypeAliasDeclaration(node)) {
    const type = node.type;
    if (ts.isTypeLiteralNode(type)) {
      return {
        kind,
        typeParams: typeParamsOf(node),
        members: membersOf(type),
        flags: flagsOf(node),
      };
    }
    return {
      kind,
      typeParams: typeParamsOf(node),
      typeShape: normalizeType(type.getText()),
      flags: flagsOf(node),
    };
  }
  if (ts.isEnumDeclaration(node)) {
    const members: EnumMemberShape[] = node.members.map((member) => ({
      name: member.name.getText(),
      value: member.initializer ? normalizeType(member.initializer.getText()) : "",
    }));
    return { kind, enumMembers: members, flags: flagsOf(node) };
  }
  if (ts.isModuleDeclaration(node)) {
    return { kind: "module", flags: flagsOf(node) };
  }
  return { kind: "const", flags: flagsOf(node) };
}

function literalKindOf(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return "string";
  if (ts.isNumericLiteral(node)) return "number";
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return "boolean";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isArrayLiteralExpression(node)) return "array";
  if (ts.isObjectLiteralExpression(node)) return "object";
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return "function";
  return "expression";
}

function variableShape(node: ts.VariableDeclaration): Shape {
  return {
    kind: "const",
    typeShape: textOf(node.type) ?? (node.initializer ? `literal:${literalKindOf(node.initializer)}` : undefined),
    literalKind: literalKindOf(node.initializer),
  };
}

function makeSymbol(
  file: ParsedFile,
  name: string,
  kind: SymbolKind,
  node: ts.Node,
  index: number,
  shape: Shape,
  parent?: Symbol,
): Symbol {
  const finalName = parent ? `${parent.name}.${name}` : name;
  const id = `${file.packageName}|${file.modulePath}|${kind}|${finalName}|${index}`;
  const qualifiedName = parent ? `${parent.qualifiedName}.${name}` : `${file.packageName}.${file.modulePath.replace(/\//gu, ".")}.${name}`;
  const shapeText = canonicalShape(shape);
  const line = file.sourceFile.getLineAndCharacterOfPosition(node.getStart(file.sourceFile)).line + 1;
  const aliases = new Set<string>();
  if (parent) {
    aliases.add(`${parent.name}.${name}`);
    aliases.add(`${parent.qualifiedName}.${name}`);
  } else {
    aliases.add(`${file.modulePath.replace(/\//gu, ".")}.${name}`);
    aliases.add(`${file.modulePath.replace(/^src\//u, "").replace(/\//gu, ".")}.${name}`);
  }
  return {
    id,
    name,
    kind,
    modulePath: file.modulePath,
    packageName: file.packageName,
    packageRoot: file.packageRoot,
    qualifiedName,
    aliases: [...aliases],
    shape,
    shapeText,
    shapeHash: shapeHash(shape),
    paramNamesHash: paramNamesHash(shape.params),
    bodyHash: hashBody(
      ts.isFunctionLike(node) && "body" in node && node.body
        ? node.body.getText(file.sourceFile)
        : node.getText(file.sourceFile),
    ),
    contractFlags: shape.flags ?? [],
    parentId: parent?.id,
    line,
    filePath: file.rel,
  };
}

function childSymbolsOf(file: ParsedFile, parent: Symbol, node: ts.Node): Symbol[] {
  const members = (node as { members?: ts.NodeArray<ts.Node> }).members;
  if (!members) return [];
  const result = new Map<string, Symbol>();
  for (const member of members) {
    if (isPrivateMember(member)) continue;
    const info = memberShapeOf(member);
    if (!info) continue;
    const symbol = makeSymbol(file, info.name, info.kind, member, 0, info.shape, parent);
    result.set(symbol.id, symbol);
  }
  return [...result.values()];
}

function collectDeclarations(file: ParsedFile): void {
  const counts = new Map<string, number>();
  const add = (name: string, kind: SymbolKind, node: ts.Node): void => {
    const key = `${kind}:${name}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    file.decls.push({ file, name, kind, node, index });
  };

  for (const statement of file.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      add(statement.name?.text ?? "default", "function", statement);
    } else if (ts.isClassDeclaration(statement)) {
      add(statement.name?.text ?? "default", "class", statement);
    } else if (ts.isInterfaceDeclaration(statement)) {
      add(statement.name.text, "interface", statement);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      add(statement.name.text, "type", statement);
    } else if (ts.isEnumDeclaration(statement)) {
      add(statement.name.text, "enum", statement);
    } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
      add(statement.name.text, "module", statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          add(declaration.name.text, "const", declaration);
          if (hasExport(statement)) {
            file.exports.push({ type: "local", exported: declaration.name.text, local: declaration.name.text });
          }
        }
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamespaceExport(statement.exportClause) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        file.exports.push({
          type: "namespace",
          exported: statement.exportClause.name.text,
          source: statement.moduleSpecifier.text,
        });
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const exported = element.name.text;
          const local = element.propertyName?.text ?? exported;
          if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            file.exports.push({
              type: "reexport",
              exported,
              source: statement.moduleSpecifier.text,
              imported: local,
            });
          } else {
            file.exports.push({ type: "local", exported, local });
          }
        }
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      file.stars.push(statement.moduleSpecifier.text);
    } else if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        file.exports.push({ type: "local", exported: "default", local: statement.expression.text });
      }
    }
  }

  for (const declaration of file.decls) {
    if (hasExport(declaration.node) || hasDefault(declaration.node)) {
      const exported = hasDefault(declaration.node) ? "default" : declaration.name;
      file.exports.push({ type: "local", exported, local: declaration.name });
    }
  }

  for (const declaration of file.decls) {
    const shape = declaration.kind === "const" && ts.isVariableDeclaration(declaration.node)
      ? variableShape(declaration.node)
      : shapeOfDeclaration(declaration.kind, declaration.node);
    const symbol = makeSymbol(declaration.file, declaration.name, declaration.kind, declaration.node, declaration.index, shape);
    const existing = file.localSymbols.get(declaration.name) ?? [];
    existing.push(symbol);
    file.localSymbols.set(declaration.name, existing);
    allSymbols.push(...childSymbolsOf(file, symbol, declaration.node));
    allSymbols.push(symbol);
  }
}

const allSymbols: Symbol[] = [];

function resolveModule(files: Map<string, ParsedFile>, from: string, specifier: string): ParsedFile | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const withoutJs = base.replace(/\.(?:m|c)?js$/u, "");
  const candidates = [base, withoutJs, ...MODULE_EXTENSIONS.map((ext) => `${withoutJs}${ext}`)];
  for (const candidate of candidates) {
    const found = files.get(candidate) ?? files.get(candidate.replace(/^\.\//u, ""));
    if (found) return found;
  }
  for (const ext of MODULE_EXTENSIONS) {
    const indexCandidate = `${withoutJs}/index${ext}`;
    const found = files.get(indexCandidate);
    if (found) return found;
  }
  return undefined;
}

function collectExportNames(
  files: Map<string, ParsedFile>,
  file: ParsedFile,
  visited: Set<string>,
): Set<string> {
  if (visited.has(file.rel)) return new Set();
  visited.add(file.rel);
  const names = new Set(
    file.exports.flatMap((record) => record.type === "star" || record.type === "namespace" ? [] : [record.exported]),
  );
  for (const source of file.stars) {
    const target = resolveModule(files, file.rel, source);
    if (!target) continue;
    for (const name of collectExportNames(files, target, visited)) names.add(name);
  }
  return names;
}

function resolveExport(
  files: Map<string, ParsedFile>,
  file: ParsedFile,
  exported: string,
  visited: Set<string>,
): Symbol[] {
  const key = `${file.rel}#${exported}`;
  if (visited.has(key)) return [];
  visited.add(key);
  const result: Symbol[] = [];
  for (const record of file.exports) {
    if (record.type === "local" && record.exported === exported) {
      result.push(...(file.localSymbols.get(record.local) ?? []));
    } else if (record.type === "reexport" && record.exported === exported) {
      const target = resolveModule(files, file.rel, record.source);
      if (target) result.push(...resolveExport(files, target, record.imported, visited));
    }
  }
  for (const source of file.stars) {
    const target = resolveModule(files, file.rel, source);
    if (target) result.push(...resolveExport(files, target, exported, visited));
  }
  return result;
}

export interface SignatureSnippet {
  name: string;
  kind: SymbolKind;
  shape: Shape;
}

export function snippetSignature(code: string, filePath = "snippet.ts"): SignatureSnippet | undefined {
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  if (sourceFile.statements.length !== 1) return undefined;
  const statement = sourceFile.statements[0];
  if (ts.isFunctionDeclaration(statement) && statement.name && !statement.body) {
    return { name: statement.name.text, kind: "function", shape: shapeOfDeclaration("function", statement) };
  }
  if (ts.isInterfaceDeclaration(statement)) {
    return { name: statement.name.text, kind: "interface", shape: shapeOfDeclaration("interface", statement) };
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return { name: statement.name.text, kind: "type", shape: shapeOfDeclaration("type", statement) };
  }
  if (ts.isClassDeclaration(statement) && statement.name) {
    const hasBody = statement.members.some((member) => "body" in member && Boolean(member.body));
    if (!hasBody) {
      return { name: statement.name.text, kind: "class", shape: shapeOfDeclaration("class", statement) };
    }
  }
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0];
    if (ts.isIdentifier(declaration.name) && declaration.type) {
      return { name: declaration.name.text, kind: "const", shape: variableShape(declaration) };
    }
  }
  return undefined;
}

export function extractTypescript(root: string, files: string[]): ExtractResult {
  allSymbols.length = 0;
  const parsed = new Map<string, ParsedFile>();
  let parseFailures = 0;

  for (const rel of files) {
    const normalized = rel.replace(/\\/gu, "/");
    let text: string;
    try {
      text = readFileSync(join(root, normalized), "utf8");
    } catch {
      parseFailures += 1;
      continue;
    }
    const sourceFile = ts.createSourceFile(normalized, text, ts.ScriptTarget.Latest, true, scriptKindFor(normalized));
    const packageInfo = findPackageRoot(root, normalized);
    const file: ParsedFile = {
      rel: normalized,
      sourceFile,
      packageName: packageInfo.name,
      packageRoot: packageInfo.root,
      modulePath: modulePathFor(packageInfo.root, join(root, normalized)),
      decls: [],
      localSymbols: new Map(),
      exports: [],
      stars: [],
      parseFailures: (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length ?? 0,
    };
    parseFailures += file.parseFailures;
    collectDeclarations(file);
    parsed.set(normalized, file);
  }

  const exportedIds = new Set<string>();
  const aliasesById = new Map<string, Set<string>>();
  for (const file of parsed.values()) {
    const names = collectExportNames(parsed, file, new Set());
    for (const exported of names) {
      const symbols = resolveExport(parsed, file, exported, new Set());
      for (const symbol of symbols) {
        exportedIds.add(symbol.id);
        const aliases = aliasesById.get(symbol.id) ?? new Set<string>();
        if (exported !== symbol.name && exported !== "default") aliases.add(exported);
        if (exported === "default") aliases.add("default");
        if (symbol.name !== exported) aliases.add(exported);
        aliasesById.set(symbol.id, aliases);
      }
    }
  }

  for (const file of parsed.values()) {
    for (const record of file.exports) {
      if (record.type !== "namespace") continue;
      const target = resolveModule(parsed, file.rel, record.source);
      if (!target) continue;
      for (const exported of collectExportNames(parsed, target, new Set())) {
        for (const symbol of resolveExport(parsed, target, exported, new Set())) {
          exportedIds.add(symbol.id);
          const aliases = aliasesById.get(symbol.id) ?? new Set<string>();
          aliases.add(`${record.exported}.${exported}`);
          aliasesById.set(symbol.id, aliases);
        }
      }
    }
  }

  const membersByParent = new Map<string, Symbol[]>();
  for (const symbol of allSymbols) {
    if (!symbol.parentId) continue;
    const list = membersByParent.get(symbol.parentId) ?? [];
    list.push(symbol);
    membersByParent.set(symbol.parentId, list);
  }

  const finalSymbols: Symbol[] = [];
  for (const symbol of allSymbols) {
    const keep = symbol.parentId ? exportedIds.has(symbol.parentId) : exportedIds.has(symbol.id);
    if (!keep) continue;
    const extra = aliasesById.get(symbol.id);
    if (extra?.size) symbol.aliases = [...new Set([...symbol.aliases, ...extra])];
    finalSymbols.push(symbol);
  }

  return { symbols: finalSymbols, parseFailures, filesScanned: parsed.size };
}
