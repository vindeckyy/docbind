#!/usr/bin/env python3
"""Static Python symbol extractor for docbind. Parses source, never imports it."""
from __future__ import annotations

import ast
import hashlib
import json
import re
import sys
from pathlib import Path


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def annotation(node: ast.AST | None) -> str:
    if node is None:
        return ""
    try:
        return normalize(ast.unparse(node))
    except Exception:
        return ""


def literal_kind(node: ast.AST | None) -> str:
    if node is None:
        return ""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, str):
            return "string"
        if isinstance(node.value, bool):
            return "boolean"
        if isinstance(node.value, (int, float)):
            return "number"
        if node.value is None:
            return "null"
        return type(node.value).__name__
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return "array"
    if isinstance(node, ast.Dict):
        return "object"
    if isinstance(node, (ast.Lambda, ast.FunctionDef, ast.AsyncFunctionDef)):
        return "function"
    return "expression"


def param_list(args: ast.arguments) -> list[dict]:
    params: list[dict] = []
    positional = list(args.posonlyargs) + list(args.args)
    default_offset = len(positional) - len(args.defaults)
    for index, arg in enumerate(positional):
        has_default = index >= default_offset
        params.append(
            {
                "name": arg.arg,
                "type": annotation(arg.annotation),
                "optional": has_default,
                "rest": False,
                "hasDefault": has_default,
                "kind": "positional",
            }
        )
    if args.vararg:
        params.append(
            {
                "name": args.vararg.arg,
                "type": annotation(args.vararg.annotation),
                "optional": True,
                "rest": True,
                "hasDefault": False,
                "kind": "vararg",
            }
        )
    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        params.append(
            {
                "name": arg.arg,
                "type": annotation(arg.annotation),
                "optional": default is not None,
                "rest": False,
                "hasDefault": default is not None,
                "kind": "kwonly",
            }
        )
    if args.kwarg:
        params.append(
            {
                "name": args.kwarg.arg,
                "type": annotation(args.kwarg.annotation),
                "optional": True,
                "rest": True,
                "hasDefault": False,
                "kind": "kwarg",
            }
        )
    return params


def flags_for(node: ast.AST, extra: list[str] | None = None) -> list[str]:
    names = list(extra or [])
    for decorator in getattr(node, "decorator_list", []):
        names.append(ast.unparse(decorator).split("(")[0].split(".")[-1])
    result: list[str] = []
    for name in names:
        if name in {"property", "staticmethod", "classmethod", "abstractmethod", "deprecated"}:
            result.append(name)
        if name == "property":
            result.append("readonly")
    return sorted(set(result))


def body_hash(node: ast.AST) -> str:
    try:
        text = normalize(ast.unparse(node))
    except Exception:
        text = ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def canonical(shape: dict) -> tuple[str, str]:
    hashed = json.loads(json.dumps(shape))
    if "params" in hashed:
        hashed["params"] = [
            {key: value for key, value in param.items() if key != "name"} for param in hashed["params"]
        ]
    text = json.dumps(hashed, sort_keys=True, separators=(",", ":"))
    params = shape.get("params") or []
    names = ",".join(param.get("name", "") for param in params)
    return (
        hashlib.sha256(text.encode("utf-8")).hexdigest()[:16],
        hashlib.sha256(names.encode("utf-8")).hexdigest()[:16],
    )


def shape_text(shape: dict) -> str:
    return json.dumps(shape, sort_keys=True, separators=(",", ":"))


def make_symbol(
    payload: dict,
    name: str,
    kind: str,
    node: ast.AST,
    shape: dict,
    index: int,
    parent: dict | None = None,
) -> dict:
    shape_hash, names_hash = canonical(shape)
    final_name = f"{parent['name']}.{name}" if parent else name
    module_path = payload["modulePath"]
    qualified = (
        f"{parent['qualifiedName']}.{name}"
        if parent
        else f"{payload['packageName']}.{module_path.replace('/', '.')}.{name}"
    )
    aliases = set()
    if parent:
        aliases.add(f"{parent['name']}.{name}")
        aliases.add(f"{parent['qualifiedName']}.{name}")
    else:
        aliases.add(f"{module_path.replace('/', '.')}.{name}")
        if module_path.startswith("src/"):
            aliases.add(f"{module_path[4:].replace('/', '.')}.{name}")
    return {
        "id": f"{payload['packageName']}|{module_path}|{kind}|{final_name}|{index}",
        "name": name,
        "kind": kind,
        "modulePath": module_path,
        "packageName": payload["packageName"],
        "packageRoot": payload["packageRoot"],
        "qualifiedName": qualified,
        "aliases": sorted(aliases),
        "shape": shape,
        "shapeText": shape_text(shape),
        "shapeHash": shape_hash,
        "paramNamesHash": names_hash,
        "bodyHash": body_hash(node),
        "contractFlags": shape.get("flags", []),
        "parentId": parent["id"] if parent else None,
        "line": getattr(node, "lineno", 1),
        "filePath": payload["rel"],
    }


def class_members(node: ast.ClassDef) -> tuple[list[dict], list[dict]]:
    members: list[dict] = []
    children: list[dict] = []
    for item in node.body:
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if item.name.startswith("_"):
                continue
            is_property = any(
                ast.unparse(decorator).split("(")[0].split(".")[-1] == "property"
                for decorator in item.decorator_list
            )
            flags = flags_for(item)
            if is_property:
                shape = {
                    "kind": "property",
                    "typeShape": annotation(item.returns),
                    "flags": flags,
                    "visibility": "public",
                }
                kind = "property"
            else:
                shape = {
                    "kind": "method",
                    "async": isinstance(item, ast.AsyncFunctionDef),
                    "params": param_list(item.args),
                    "returnType": annotation(item.returns),
                    "flags": flags,
                    "visibility": "public",
                }
                kind = "method"
            members.append(
                {
                    "name": item.name,
                    "kind": kind,
                    "optional": False,
                    "shape": shape,
                }
            )
            children.append({"node": item, "name": item.name, "kind": kind, "shape": shape})
        elif isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
            if item.target.id.startswith("_"):
                continue
            shape = {
                "kind": "property",
                "typeShape": annotation(item.annotation),
                "flags": ["readonly"] if item.value is None else [],
                "visibility": "public",
            }
            members.append(
                {
                    "name": item.target.id,
                    "kind": "property",
                    "optional": item.value is not None,
                    "shape": shape,
                }
            )
            children.append({"node": item, "name": item.target.id, "kind": "property", "shape": shape})
    return members, children


def function_shape(node: ast.FunctionDef | ast.AsyncFunctionDef) -> tuple[str, dict]:
    flags = flags_for(node)
    if "property" in flags:
        return "property", {
            "kind": "property",
            "typeShape": annotation(node.returns),
            "flags": flags,
            "visibility": "public",
        }
    return "function", {
        "kind": "function",
        "async": isinstance(node, ast.AsyncFunctionDef),
        "params": param_list(node.args),
        "returnType": annotation(node.returns),
        "flags": flags,
        "visibility": "public",
    }


def extract_file(root: Path, payload: dict) -> tuple[list[dict], set[str], int]:
    path = root / payload["rel"]
    try:
        text = path.read_text(encoding="utf-8")
        tree = ast.parse(text, filename=str(path))
    except (OSError, SyntaxError):
        return [], set(), 1

    exported_all: set[str] | None = None
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            for target in statement.targets:
                if isinstance(target, ast.Name) and target.id == "__all__":
                    try:
                        value = ast.literal_eval(statement.value)
                        if isinstance(value, (list, tuple)):
                            exported_all = {str(item) for item in value}
                    except Exception:
                        exported_all = set()

    symbols: list[dict] = []
    counts: dict[str, int] = {}

    def next_index(kind: str, name: str) -> int:
        key = f"{kind}:{name}"
        index = counts.get(key, 0)
        counts[key] = index + 1
        return index

    for statement in tree.body:
        if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if statement.name.startswith("_"):
                continue
            if exported_all is not None and statement.name not in exported_all:
                continue
            kind, shape = function_shape(statement)
            symbols.append(
                make_symbol(payload, statement.name, kind, statement, shape, next_index(kind, statement.name))
            )
        elif isinstance(statement, ast.ClassDef):
            if statement.name.startswith("_"):
                continue
            if exported_all is not None and statement.name not in exported_all:
                continue
            members, child_infos = class_members(statement)
            shape = {
                "kind": "class",
                "extends": [normalize(ast.unparse(base)) for base in statement.bases],
                "members": members,
                "flags": flags_for(statement),
                "visibility": "public",
            }
            parent = make_symbol(
                payload, statement.name, "class", statement, shape, next_index("class", statement.name)
            )
            symbols.append(parent)
            for child in child_infos:
                symbols.append(
                    make_symbol(
                        payload,
                        child["name"],
                        child["kind"],
                        child["node"],
                        child["shape"],
                        next_index(child["kind"], child["name"]),
                        parent,
                    )
                )
        elif isinstance(statement, (ast.Assign, ast.AnnAssign)):
            targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
            for target in targets:
                if not isinstance(target, ast.Name) or target.id.startswith("_"):
                    continue
                if exported_all is not None and target.id not in exported_all:
                    continue
                value = statement.value
                shape = {
                    "kind": "const",
                    "typeShape": annotation(statement.annotation) if isinstance(statement, ast.AnnAssign) else "",
                    "literalKind": literal_kind(value),
                    "flags": [],
                }
                symbols.append(
                    make_symbol(payload, target.id, "const", statement, shape, next_index("const", target.id))
                )
    return symbols, exported_all or set(), 0


def apply_import_aliases(root: Path, payloads: list[dict], symbols: list[dict]) -> None:
    by_module_name: dict[tuple[str, str], dict] = {
        (symbol["modulePath"], symbol["name"]): symbol for symbol in symbols if not symbol.get("parentId")
    }
    modules = {payload["modulePath"]: payload for payload in payloads}
    for payload in payloads:
        path = root / payload["rel"]
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError):
            continue
        current = payload["modulePath"]
        for statement in tree.body:
            if not isinstance(statement, ast.ImportFrom):
                continue
            if statement.level:
                base = current.split("/")[:-1]
                keep = max(0, len(base) - (statement.level - 1))
                parts = base[:keep]
                if statement.module:
                    parts.extend(statement.module.split("."))
                target_module = "/".join(parts)
            else:
                target_module = (statement.module or "").replace(".", "/")
            if target_module not in modules:
                continue
            for alias in statement.names:
                target = by_module_name.get((target_module, alias.name))
                if target is None:
                    continue
                local = alias.asname or alias.name
                if local != target["name"] and local not in target["aliases"]:
                    target["aliases"].append(local)
                    target["aliases"].sort()


def main() -> int:
    payloads = json.loads(sys.stdin.read())
    root = Path(payloads["root"])
    files = payloads["files"]
    symbols: list[dict] = []
    parse_failures = 0
    for payload in files:
        extracted, _exported, failures = extract_file(root, payload)
        symbols.extend(extracted)
        parse_failures += failures
    apply_import_aliases(root, files, symbols)
    print(json.dumps({"symbols": symbols, "parseFailures": parse_failures, "filesScanned": len(files)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
