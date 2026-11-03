import type { Symbol } from "../types.js";

export interface PythonTypeHints {
  classes: Set<string>;
  returns: Map<string, string>;
}

export interface GoTypeHints {
  types: Set<string>;
  returns: Map<string, string>;
  values: Map<string, string>;
  fields: Map<string, string>;
}

function returnTypeName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split("|")[0]?.trim() ?? "";
  if (!first) return undefined;
  const names = first.replace(/^typing\./u, "").match(/[A-Za-z_]\w*/gu) ?? [];
  return names[names.length - 1];
}

export function buildPythonTypeHints(symbols: Symbol[]): PythonTypeHints {
  const classes = new Set(
    symbols
      .filter((symbol) => ["class", "interface", "enum", "type"].includes(symbol.kind))
      .map((symbol) => symbol.name),
  );
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const returns = new Map<string, Set<string>>();
  const add = (key: string, type: string): void => {
    const values = returns.get(key) ?? new Set<string>();
    values.add(type);
    returns.set(key, values);
  };

  for (const symbol of symbols) {
    if (!symbol.shape.returnType) continue;
    const type = returnTypeName(symbol.shape.returnType);
    if (!type || !classes.has(type)) continue;
    const parent = symbol.parentId ? byId.get(symbol.parentId) : undefined;
    const keys = new Set<string>();
    if (parent) {
      keys.add(`${parent.name}.${symbol.name}`);
      keys.add(`${symbol.packageName}.${parent.name}.${symbol.name}`);
      keys.add(`${parent.qualifiedName}.${symbol.name}`);
    } else {
      keys.add(symbol.name);
      keys.add(`${symbol.packageName}.${symbol.name}`);
    }
    for (const alias of symbol.aliases) {
      if (alias.includes(".")) keys.add(alias);
    }
    for (const key of keys) add(key, type);
  }

  const resolved = new Map<string, string>();
  for (const [key, values] of returns) {
    if (values.size === 1) resolved.set(key, [...values][0] as string);
  }
  return { classes, returns: resolved };
}

function goTypeName(raw: string): string | undefined {
  const first = raw.replace(/^\(/u, "").split(",")[0] ?? "";
  const names = first.replace(/^\*+/u, "").replace(/^\[\]/u, "").match(/[A-Za-z_]\w*/gu) ?? [];
  return names[names.length - 1];
}

export function buildGoTypeHints(symbols: Symbol[]): GoTypeHints {
  const types = new Set(
    symbols
      .filter((symbol) => ["class", "interface", "enum", "type"].includes(symbol.kind))
      .map((symbol) => symbol.name),
  );
  const returns = new Map<string, Set<string>>();
  const add = (key: string, type: string): void => {
    const values = returns.get(key) ?? new Set<string>();
    values.add(type);
    returns.set(key, values);
  };

  for (const symbol of symbols) {
    if (symbol.parentId || !symbol.shape.returnType) continue;
    const type = goTypeName(symbol.shape.returnType);
    if (!type || !types.has(type)) continue;
    const keys = new Set<string>([symbol.name, `${symbol.packageName}.${symbol.name}`]);
    for (const alias of symbol.aliases) {
      if (alias.includes(".")) keys.add(alias);
    }
    for (const key of keys) add(key, type);
  }

  const resolved = new Map<string, string>();
  for (const [key, values] of returns) {
    if (values.size === 1) resolved.set(key, [...values][0] as string);
  }

  const valueTypes = new Map<string, Set<string>>();
  const addValue = (key: string, type: string): void => {
    const values = valueTypes.get(key) ?? new Set<string>();
    values.add(type);
    valueTypes.set(key, values);
  };
  for (const symbol of symbols) {
    if (symbol.parentId || !symbol.goValue) continue;
    const cleaned = symbol.goValue.trim().replace(/^&/u, "");
    const call = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/u.exec(cleaned);
    const composite = /^([A-Za-z_]\w*)\s*\{/u.exec(cleaned);
    const type = call?.[1]
      ? resolved.get(call[1]) ?? resolved.get(`${symbol.packageName}.${call[1]}`)
      : composite?.[1] && types.has(composite[1]) ? composite[1] : undefined;
    if (!type) continue;
    const keys = new Set<string>([symbol.name, `${symbol.packageName}.${symbol.name}`]);
    for (const alias of symbol.aliases) {
      if (alias.includes(".")) keys.add(alias);
    }
    for (const key of keys) addValue(key, type);
  }
  const values = new Map<string, string>();
  for (const [key, found] of valueTypes) {
    if (found.size === 1) values.set(key, [...found][0] as string);
  }

  const fieldTypes = new Map<string, Set<string>>();
  const addField = (key: string, type: string): void => {
    const found = fieldTypes.get(key) ?? new Set<string>();
    found.add(type);
    fieldTypes.set(key, found);
  };
  for (const symbol of symbols) {
    if (!["class", "interface"].includes(symbol.kind)) continue;
    for (const member of symbol.shape.members ?? []) {
      const type = goTypeName(member.shape.typeShape ?? "");
      if (type && types.has(type)) addField(`${symbol.name}.${member.name}`, type);
    }
  }
  const fields = new Map<string, string>();
  for (const [key, found] of fieldTypes) {
    if (found.size === 1) fields.set(key, [...found][0] as string);
  }
  return { types, returns: resolved, values, fields };
}
