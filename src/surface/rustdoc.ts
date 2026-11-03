import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { findPackageRoot, modulePathFor } from "../discover.js";
import { canonicalShape, bodyHash, paramNamesHash, shapeHash } from "../shape/canonical.js";
import type { ExtractResult } from "./protocol.js";
import type { ParamShape, Shape, Symbol, SymbolKind } from "../types.js";

interface RustdocItem {
  id?: number;
  name?: string;
  visibility?: unknown;
  span?: { filename?: string; begin?: [number, number] };
  inner?: Record<string, unknown>;
  items?: number[];
}

interface RustdocIndex {
  index?: Record<string, RustdocItem>;
}

export interface CargoResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type CargoRunner = (args: string[], cwd: string) => CargoResult;

const defaultCargo: CargoRunner = (args, cwd) => {
  const result = spawnSync("cargo", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    /* v8 ignore next 2 */
    stdout: result.stdout ?? "",
    /* v8 ignore next 2 */
    stderr: result.stderr ?? "",
  };
};

function isPublic(visibility: unknown): boolean {
  return visibility === "public" || visibility === "default" || visibility === undefined;
}

export function typeText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.primitive === "string") return record.primitive;
  if (typeof record.generic === "string") return record.generic;
  if (typeof record.infer === "string") return record.infer;
  if (typeof record.resolved_path === "object" && record.resolved_path) {
    const path = record.resolved_path as Record<string, unknown>;
    const name = typeof path.name === "string"
      ? path.name
      : typeof path.path === "string"
        ? path.path.split("::").pop() ?? "unknown"
        : "unknown";
    const args = path.args as Record<string, unknown> | undefined;
    const angle = args?.angle_bracketed as Record<string, unknown> | undefined;
    const values = Array.isArray(angle?.args) ? angle.args : [];
    const rendered = values
      .map((argument) => {
        const item = argument as Record<string, unknown>;
        if (item.type) return typeText(item.type);
        if (item.lifetime) return `'${String(item.lifetime)}`;
        return "";
      })
      .filter(Boolean);
    return rendered.length > 0 ? `${name}<${rendered.join(",")}>` : name;
  }
  if (typeof record.borrowed_ref === "object" && record.borrowed_ref) {
    const reference = record.borrowed_ref as Record<string, unknown>;
    return `${reference.mutable ? "&mut " : "&"}${typeText(reference.type)}`;
  }
  if (typeof record.raw_pointer === "object" && record.raw_pointer) {
    const pointer = record.raw_pointer as Record<string, unknown>;
    return `${pointer.mutable ? "*mut " : "*const "}${typeText(pointer.type)}`;
  }
  if (Array.isArray(record.tuple)) return `(${record.tuple.map(typeText).join(",")})`;
  if (record.slice) return `[${typeText(record.slice)}]`;
  if (record.array) {
    const array = record.array as Record<string, unknown>;
    return `[${typeText(array.type)};${String(array.len)}]`;
  }
  if (record.qualified_path) {
    const path = record.qualified_path as Record<string, unknown>;
    return typeText(path.self_type);
  }
  if (record.impl_trait) return "impl Trait";
  if (record.dyn_trait) return "dyn Trait";
  return "";
}

export function typeName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.resolved_path === "object" && record.resolved_path) {
    const path = record.resolved_path as Record<string, unknown>;
    if (typeof path.name === "string") return path.name.split("::").pop();
    if (typeof path.path === "string") return path.path.split("::").pop();
  }
  if (typeof record.generic === "string") return record.generic;
  return undefined;
}

function shapeFromFunction(input: Record<string, unknown>, method: boolean): Shape {
  const signature = (input.sig as Record<string, unknown> | undefined) ?? {};
  const inputs = Array.isArray(signature.inputs) ? signature.inputs : [];
  const params: ParamShape[] = inputs.map((value, index) => {
    const named = Array.isArray(value) && value.length >= 2 ? value : undefined;
    const name = named ? String(named[0]) : `arg${index}`;
    const type = typeText(named ? named[1] : value);
    return {
      name,
      type,
      optional: false,
      rest: false,
      hasDefault: false,
      ...(name === "self" ? { kind: "receiver" } : {}),
    };
  });
  const generics = (input.generics as Record<string, unknown> | undefined) ?? {};
  const typeParams = Array.isArray(generics.params)
    ? generics.params
        .map((parameter) => (parameter as Record<string, unknown>).name)
        .filter((name): name is string => typeof name === "string")
    : [];
  const header = (input.header as Record<string, unknown> | undefined) ?? {};
  const output = typeText(signature.output);
  return {
    kind: method ? "method" : "function",
    async: header.is_async === true,
    generator: false,
    typeParams: typeParams.length > 0 ? typeParams.join(",") : undefined,
    params,
    returnType: output || undefined,
    visibility: "public",
    flags: header.is_unsafe === true ? ["unsafe"] : [],
  };
}

function typeParamsFor(generics: Record<string, unknown> | undefined): string | undefined {
  const params = Array.isArray(generics?.params) ? generics.params : [];
  const names = params
    .map((parameter) => (parameter as Record<string, unknown>).name)
    .filter((name): name is string => typeof name === "string");
  return names.length > 0 ? names.join(",") : undefined;
}

function makeRustdocSymbol(
  item: RustdocItem,
  name: string,
  kind: SymbolKind,
  shape: Shape,
  root: string,
  packageRoot: string,
  packageName: string,
  parentName?: string,
): Symbol {
  const filename = item.span?.filename ?? "";
  const absolute = join(root, filename);
  const filePath = existsSync(absolute) ? relative(root, absolute).replace(/\\/gu, "/") : filename;
  const modulePath = filePath.endsWith(".rs") ? modulePathFor(packageRoot, join(root, filePath)) : "rustdoc";
  const shapeText = canonicalShape(shape);
  const qualified = `${packageName}.${modulePath.replace(/\//gu, ".")}.${parentName ? `${parentName}.` : ""}${name}`;
  return {
    id: `${packageName}|rustdoc|${kind}|${parentName ? `${parentName}.` : ""}${name}|${item.id ?? 0}`,
    name,
    kind,
    modulePath,
    packageName,
    packageRoot,
    qualifiedName: qualified,
    aliases: [
      `${modulePath.replace(/\//gu, ".")}.${parentName ? `${parentName}.` : ""}${name}`,
      `${packageName}.${parentName ? `${parentName}.` : ""}${name}`,
      ...(parentName ? [`${parentName}.${name}`] : []),
    ],
    shape,
    shapeText,
    shapeHash: shapeHash(shape),
    paramNamesHash: paramNamesHash(shape.params),
    bodyHash: bodyHash(""),
    contractFlags: shape.flags ?? [],
    line: item.span?.begin?.[0] ?? 1,
    filePath,
  };
}

function symbolFromFunction(
  item: RustdocItem,
  functionInput: Record<string, unknown>,
  root: string,
  packageRoot: string,
  packageName: string,
  parentName?: string,
): Symbol | undefined {
  if (!item.name || !isPublic(item.visibility)) return undefined;
  const kind: SymbolKind = parentName ? "method" : "function";
  return makeRustdocSymbol(
    item,
    item.name,
    kind,
    shapeFromFunction(functionInput, Boolean(parentName)),
    root,
    packageRoot,
    packageName,
    parentName,
  );
}

function typeSymbols(
  item: RustdocItem,
  index: Record<string, RustdocItem>,
  root: string,
  packageRoot: string,
  packageName: string,
): Symbol[] {
  if (!item.name || !isPublic(item.visibility)) return [];
  const inner = item.inner ?? {};
  const symbols: Symbol[] = [];
  const generics = (entry: Record<string, unknown> | undefined): string | undefined =>
    typeParamsFor(entry?.generics as Record<string, unknown> | undefined);

  if (inner.struct) {
    const struct = inner.struct as Record<string, unknown>;
    const kind = struct.kind;
    const members: Array<{ name: string; type: string }> = [];
    const fieldIds = kind && typeof kind === "object"
      ? Array.isArray((kind as Record<string, unknown>).tuple)
        ? ((kind as Record<string, unknown>).tuple as number[])
        : Array.isArray(((kind as Record<string, unknown>).plain as Record<string, unknown> | undefined)?.fields)
          ? (((kind as Record<string, unknown>).plain as Record<string, unknown>).fields as number[])
          : []
      : [];
    for (const id of fieldIds) {
      const field = index[String(id)];
      if (!field?.name || !isPublic(field.visibility)) continue;
      const type = typeText(field.inner?.struct_field);
      members.push({ name: field.name, type });
      symbols.push(makeRustdocSymbol(
        field,
        field.name,
        "property",
        { kind: "property", typeShape: type, visibility: "public" },
        root,
        packageRoot,
        packageName,
        item.name,
      ));
    }
    symbols.unshift(makeRustdocSymbol(
      item,
      item.name,
      "class",
      {
        kind: "class",
        typeParams: generics(struct),
        members: members.map((member) => ({
          name: member.name,
          kind: "property",
          optional: false,
          shape: { kind: "property", typeShape: member.type, visibility: "public" },
        })),
      },
      root,
      packageRoot,
      packageName,
    ));
  } else if (inner.enum) {
    const enumData = inner.enum as Record<string, unknown>;
    const variantIds = Array.isArray(enumData.variants) ? enumData.variants : [];
    const members = [];
    for (const id of variantIds) {
      const variant = index[String(id)];
      if (!variant?.name) continue;
      const variantData = (variant.inner?.variant as Record<string, unknown> | undefined) ?? {};
      const kind = variantData.kind;
      let value = "";
      if (kind && typeof kind === "object") {
        const record = kind as Record<string, unknown>;
        if (Array.isArray(record.tuple)) {
          value = record.tuple.map((fieldId) => typeText(index[String(fieldId)]?.inner?.struct_field)).join(",");
        } else if (record.struct) {
          const fields = (record.struct as Record<string, unknown>).fields;
          if (Array.isArray(fields)) {
            value = fields
              .map((fieldId) => {
                const field = index[String(fieldId)];
                return `${field?.name ?? "field"}:${typeText(field?.inner?.struct_field)}`;
              })
              .join(",");
          }
        }
      }
      members.push({ name: variant.name, value });
      symbols.push(makeRustdocSymbol(
        variant,
        variant.name,
        "enumMember",
        { kind: "enumMember", literalKind: value || "unit" },
        root,
        packageRoot,
        packageName,
        item.name,
      ));
    }
    symbols.unshift(makeRustdocSymbol(
      item,
      item.name,
      "enum",
      { kind: "enum", typeParams: generics(enumData), enumMembers: members },
      root,
      packageRoot,
      packageName,
    ));
  } else if (inner.trait) {
    const traitData = inner.trait as Record<string, unknown>;
    const bounds = Array.isArray(traitData.bounds) ? traitData.bounds.map(typeText).filter(Boolean) : [];
    const itemIds = Array.isArray(traitData.items) ? traitData.items : [];
    const members = itemIds
      .map((id) => index[String(id)])
      .filter((method): method is RustdocItem => Boolean(method?.name && method.inner?.function))
      .map((method) => ({
        name: method.name!,
        kind: "method" as const,
        optional: false,
        shape: shapeFromFunction(method.inner!.function as Record<string, unknown>, true),
      }));
    symbols.unshift(makeRustdocSymbol(
      item,
      item.name,
      "interface",
      { kind: "interface", typeParams: generics(traitData), extends: bounds, members },
      root,
      packageRoot,
      packageName,
    ));
  } else if (inner.type_alias) {
    const alias = inner.type_alias as Record<string, unknown>;
    symbols.unshift(makeRustdocSymbol(
      item,
      item.name,
      "type",
      { kind: "type", typeParams: generics(alias), typeShape: typeText(alias.type) },
      root,
      packageRoot,
      packageName,
    ));
  } else if (inner.constant) {
    const constant = inner.constant as Record<string, unknown>;
    symbols.unshift(makeRustdocSymbol(
      item,
      item.name,
      "const",
      { kind: "const", typeShape: typeText(constant.type) },
      root,
      packageRoot,
      packageName,
    ));
  }
  return symbols;
}

export function parseRustdocJson(
  data: RustdocIndex,
  root: string,
  packageRoot: string,
  packageName: string,
): Symbol[] {
  const index = data.index ?? {};
  const symbols: Symbol[] = [];
  const seen = new Set<string>();
  const add = (symbol: Symbol | undefined): void => {
    if (!symbol) return;
    const key = `${symbol.name}|${symbol.kind}|${symbol.qualifiedName}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push(symbol);
  };

  for (const item of Object.values(index)) {
    const inner = item.inner ?? {};
    if (inner.function && item.name) {
      add(symbolFromFunction(item, inner.function as Record<string, unknown>, root, packageRoot, packageName));
    }
    if (inner.impl) {
      const implementation = inner.impl as Record<string, unknown>;
      const target = typeName(implementation.for);
      const itemIds = Array.isArray(implementation.items) ? implementation.items : [];
      for (const id of itemIds) {
        const method = index[String(id)];
        const methodInner = method?.inner?.function;
        if (method && methodInner && target) {
          add(symbolFromFunction(
            method,
            methodInner as Record<string, unknown>,
            root,
            packageRoot,
            packageName,
            target,
          ));
        }
      }
    }
    if (inner.trait) {
      const traitItem = inner.trait as Record<string, unknown>;
      const itemIds = Array.isArray(traitItem.items) ? traitItem.items : [];
      for (const id of itemIds) {
        const method = index[String(id)];
        const methodInner = method?.inner?.function;
        if (method && methodInner && item.name) {
          add(symbolFromFunction(
            method,
            methodInner as Record<string, unknown>,
            root,
            packageRoot,
            packageName,
            item.name,
          ));
        }
      }
    }
    if (inner.proc_macro && item.name) {
      add({
        ...symbolFromFunction(
          { ...item, visibility: "public" },
          { sig: { inputs: [] }, header: {}, generics: {} },
          root,
          packageRoot,
          packageName,
        )!,
        kind: "function",
      });
    }
    for (const symbol of typeSymbols(item, index, root, packageRoot, packageName)) add(symbol);
  }
  return symbols;
}

function packageMetadata(
  packageRoot: string,
  runner: CargoRunner,
): { name: string; target: string } | undefined {
  const result = runner(["metadata", "--no-deps", "--format-version", "1"], packageRoot);
  if (result.status !== 0) return undefined;
  try {
    const metadata = JSON.parse(result.stdout) as {
      target_directory?: string;
      packages?: Array<{ name: string; manifest_path: string }>;
    };
    const manifest = join(packageRoot, "Cargo.toml");
    const pkg = metadata.packages?.find((candidate) => candidate.manifest_path === manifest);
    if (!pkg?.name || !metadata.target_directory) return undefined;
    return { name: pkg.name, target: metadata.target_directory };
  } catch {
    return undefined;
  }
}

export function extractRustdoc(
  root: string,
  files: string[],
  runner: CargoRunner = defaultCargo,
): ExtractResult {
  const packageRoots = new Set(files.map((file) => findPackageRoot(root, file).root));
  const symbols: Symbol[] = [];
  let parseFailures = 0;
  const errors: string[] = [];
  for (const packageRoot of packageRoots) {
    const metadata = packageMetadata(packageRoot, runner);
    if (!metadata) continue;
    const build = runner(
      ["+nightly", "rustdoc", "--lib", "--", "-Z", "unstable-options", "--output-format", "json"],
      packageRoot,
    );
    if (build.status !== 0) {
      parseFailures += 1;
      errors.push((build.stderr || "rustdoc failed").trim());
      continue;
    }
    const jsonPath = join(metadata.target, "doc", `${metadata.name.replace(/-/gu, "_")}.json`);
    try {
      const data = JSON.parse(readFileSync(jsonPath, "utf8")) as RustdocIndex;
      symbols.push(...parseRustdocJson(data, root, packageRoot, metadata.name));
    } catch (error) {
      parseFailures += 1;
      errors.push(`cannot read rustdoc json: ${(error as Error).message}`);
    }
  }
  return {
    symbols,
    parseFailures,
    filesScanned: 0,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}
