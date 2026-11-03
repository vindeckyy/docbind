# docbind: symbol-level documentation staleness

Design plan for a static analyzer that binds symbol-shaped markdown references to exported code symbols and reports drift when the code changes and the doc claim does not.

Repo: `/Users/hayden/Desktop/Projects/docbind`

Status: M1 through M6 implemented. A light M0 prior-art sweep is in `docs/prior-art.md`; publication remains a release task. M7 language breadth is deferred.

Working name: `docbind`.

Implemented surface:

- TypeScript, JavaScript, and Python extraction.
- Markdown inline code, tables, headings, fenced code, signature fences, and explicit references.
- Score-gated resolution, lock file, three-way diff, tombstones, rename and move inference.
- Compatibility lattice, SARIF, GitHub annotations, CLI, fix engine.
- Gates: 95% test coverage, 95% changed-line coverage, 95% structure.

Current gate results at the implementation commit:

- Test coverage: 99.47% statements, 95.43% branches, 100% functions, 99.47% lines.
- Changed-line coverage: 100% on the last code diff; 99.47% across all executable lines.
- Structure gate: 47 of 47 checks.

Deferred: Rust and Go extractors, docs site, prior-art publication.

---

## 1. Position

Documentation tools move in one direction: code to docs. TypeDoc, pydoc-markdown, rustdoc, and mdBook render what the code says. Link checkers verify URLs. Prose linters check style. Snippet runners execute examples. None of them answer the question this tool answers:

> This inline code span in the docs named an exported symbol last month. The symbol's contract changed since then. Did the sentence change?

The 2026 audit calls this the code-surface to doc-surface staleness hole. The premise matters because it defines the product: not a generator, not a linter for prose, and not a coverage report. A static analysis pass over two surfaces, with a persistent binding between them.

The audit's claim gets verified in M0. If a shipped tool already persists symbol bindings across commits and diffs their contracts, stop and reassess. The named candidates are in section 18.

### Why the obvious approaches fail

| Approach | Failure |
|---|---|
| Check that each backticked name still exists | Flags prose (`install`, `true`, `GET /users`) and misses contract changes (`getUser` still exists but now returns `Result<User>`) |
| Regenerate docs from code | Rewrites handwritten docs and loses prose the generator cannot produce |
| Lint docstrings next to code | Never reads markdown, so README and guides stay invisible |
| Execute code snippets | Only works when snippets run, and says nothing about a symbol mentioned in a sentence |
| Search for references on demand | No baseline, so it cannot tell a stale claim from a claim that was never true |
| Diff the markdown file | Reports rewrites and typo fixes, not semantic drift |

The missing mechanism is a binding with memory: doc anchor, symbol identity, and contract shape, stored at the moment the doc claim was last true.

---

## 2. Product contract

These invariants are the specification. Every design choice below serves one of them, and every release gate tests them.

**I1. Clean run.** An unchanged repository with unchanged docs produces zero findings. This is the headline claim and the first CI gate.

**I2. No unbound findings.** A token that never bound to a tracked symbol never produces a finding. Brokenness is reported only when the token matches a tombstone from the lock or the doc used explicit reference syntax (`{@link foo}`, a Sphinx role, `seealso`). This is the false-positive firewall, and it is stronger than tuning heuristics.

**I3. Additive silence.** Adding an optional parameter, an overload, an optional field, or an enum variant produces no finding. Shape comparison uses a compatibility lattice, not raw inequality.

**I4. History exclusion.** `CHANGELOG*`, `HISTORY*`, `releases/**`, and migration guides are excluded by default. Old names in historical docs are correct by definition.

**I5. Ambiguity never fails.** A name exported in two packages with no import evidence stays unbound. The tool prints a note under `--all`, never an error.

**I6. Reproducibility.** Every finding can be reproduced with `docbind explain <doc>:<line>`, which prints candidates, scores, and vetoes.

**I7. Idempotent fixes.** `docbind fix --write` followed by `docbind check` produces no findings from the fixed rules, and a second fix changes nothing.

### Non-goals for v1

- Generating documentation.
- Checking whether every exported symbol is documented.
- Reading docstrings or code comments as documentation.
- Detecting prose that contradicts code without naming a symbol.
- Verifying URLs, anchors, or images.
- Executing snippets.
- Type checking. Shape comparison is syntactic and canonical, not semantic.
- Binding names that are not inside backticks. Plain prose is out of scope, including in `--strict` mode.

### Targets, not results

These are release gates. They are not measurements yet.

| Metric | Target |
|---|---|
| Findings that are correct on the labeled corpus | at least 98% |
| Recall on seeded L1, L2, L4 mutations | at least 90% |
| Recall on seeded L3 shape mutations | at least 85% |
| Findings on unchanged repositories | 0 |
| Cold run, 5k code files and 1k docs | under 10s on a current laptop |
| Warm run | under 2s |

---

## 3. Design thesis: staleness is a diff

A finding needs two facts at once: the doc claim did not change, and the code contract did change in a breaking direction.

Store the claim:

- doc anchor `D`: path, local context fingerprint, token, occurrence
- symbol identity `S`: stable ID
- claimed shape `H`: canonical contract hash at the time the doc last matched
- confidence `C`: frozen at bind time

On each run:

- base = lock entry `(D, S, H, C)`
- ours = current code surface `S1`
- theirs = current doc anchors `D1`

```text
if D1 is missing or its context or token changed:
    the doc side moved. Drop the old claim and re-bind from scratch.
else if S is missing from S1:
    emit broken or renamed.
else if compare(H, shape(S1)) is breaking:
    emit reshaped.
else:
    say nothing.
```

The lock stores the shape the doc last asserted, not the latest shape seen. That choice matters. If code adds an optional parameter, the lock keeps the old shape and stays silent. If code later removes that parameter, the old shape is restored and the doc is accurate again. If code adds a required parameter after the optional one, comparison against the doc's baseline catches the break. Comparing against the latest seen shape would either create lock churn on every additive change or lose the doc's baseline. Section 11 covers the mechanics.

A second rule keeps the tool quiet: a fresh token that does not resolve is not a finding. Without history, "not found" is indistinguishable from prose. With tombstones from the lock, a deleted symbol is distinguishable from a word in backticks.

---

## 4. Architecture

```text
discover ──> code surface ──┐
                            ├──> resolve ──> diff(lock, code, docs) ──> findings ──> report
docs ────> doc surface ─────┘                          │
                                                       └──> lock update / fix
```

Components:

1. `discover`: file selection, exclusions, package roots, generated-doc detection.
2. `surface`: one extractor per language, behind a JSON protocol.
3. `docs`: markdown parsing, anchor extraction, fence parsing, context fingerprints.
4. `resolve`: candidate generation, scoring, vetoes, ambiguity handling.
5. `shape`: canonical contract strings and the compatibility lattice.
6. `lock`: read, validate, sort, write, prune tombstones.
7. `diff`: three-way comparison and finding construction.
8. `rename`: symbol-level rename and move inference.
9. `report`: human output, JSON, SARIF, GitHub annotations.
10. `fix`: conservative token and qualified-path replacement.

Everything runs in one Node process except language sidecars. No network access. No project code execution.

### Trust model

The tool runs on untrusted pull requests in CI. Extractors must parse, not run, project code.

- TypeScript: compiler API, syntactic only. Safe.
- Python: `griffe` static analysis. Safe. It does not import the package.
- Rust: `rustdoc --output-format json` compiles, which runs `build.rs` and proc macros. Unsafe by default. The Rust extractor must use a syntactic parser (`syn`) unless the user passes `--allow-build`.
- Go: `go/packages` type-checks and may run cgo tooling. Opt-in for the same reason.

This constraint shapes language support. A syntactic extractor is less accurate on re-exports but safe on a hostile PR. Document the tradeoff in the README.

---

## 5. Repository layout

```text
docbind/
  PLAN.md
  package.json
  tsconfig.json
  src/
    cli.ts
    config.ts
    discover.ts
    git.ts
    hash.ts
    docs/
      parse.ts
      anchors.ts
      fences.ts
      context.ts
    surface/
      index.ts
      protocol.ts
      typescript.ts
      python.ts
    resolve/
      resolve.ts
      score.ts
      tombstone.ts
      rename.ts
    shape/
      canonical.ts
      compat.ts
    lock/
      schema.ts
      read.ts
      write.ts
      merge.ts
    report/
      human.ts
      json.ts
      sarif.ts
      github.ts
    fix.ts
  test/
    fixtures/
      <case>/
        v0/
        v1/
        expect.json
    mutation/
    corpus/            # fetched by script, gitignored
  scripts/
    fetch-corpus.ts
    measure.ts
    label.ts
  action/
    action.yml
  docs/                # dogfood target
```

Stack:

- Node 20 or newer, TypeScript 5.x, ESM.
- `typescript` for the TS and JS extractor.
- `mdast-util-from-markdown`, `mdast-util-gfm`, `unist-util-visit` for markdown and exact source positions.
- `tinyglobby` for file discovery, `ignore` for `.gitignore`.
- `picocolors` for terminal output.
- `zod` for config and lock validation.
- `parseArgs` from `node:util` for the CLI. No CLI framework.
- `vitest` and `fast-check` for tests.
- `tsup` for bundling.
- `griffe` as an optional Python dependency, invoked as a subprocess.

No markdown AST library beyond mdast. No git library; call the `git` binary with `execFile`. No SARIF library; the schema subset is small.

Distribution: npm package, run with `npx docbind`. A standalone binary through Node SEA comes later if adoption justifies it. The Node requirement is the price for reliable markdown positions and the TS compiler in one runtime.

---

## 6. Data model

```ts
export type SymbolKind =
  | "function" | "class" | "method" | "property"
  | "interface" | "type" | "const" | "enum" | "enumMember" | "module";

export interface Symbol {
  id: string;               // pkg|module|kind|name|overload, percent-encoded
  name: string;
  kind: SymbolKind;
  modulePath: string;
  qualifiedName: string;
  aliases: string[];
  shape: string;
  shapeHash: string;
  paramNamesHash: string;   // only used by call-form doc claims
  bodyHash: string;         // rename evidence, never a finding on its own
  contractFlags: Array<"deprecated" | "async" | "generator" | "abstract" | "readonly" | "static">;
  parentId?: string;
}
```

`id` is readable because findings, ignores, and SARIF all show it. Percent-encode `|` and `%` so the separator stays unambiguous. Overloads get an index based on declaration order after canonical sorting.

```ts
export interface DocAnchor {
  docPath: string;
  line: number;
  column: number;
  length: number;
  token: string;
  occurrence: number;       // disambiguates identical anchors in one file
  surface: "inlineCode" | "headingCode" | "tableCode" | "fenceToken" | "signatureFence" | "explicitRef";
  fenceLang?: string;
  contextFp: string;
  importTable: Record<string, string>;
  localDecls: string[];
}

export interface Finding {
  id: string;               // sha256(docPath, token, symbolId, rule), 12 chars
  rule: "L1-broken" | "L2-moved" | "L3-reshaped" | "L4-renamed" | "S1-deprecated";
  severity: "error" | "warning" | "note";
  doc: { path: string; line: number; column: number; length: number };
  code?: { path: string; line: number; symbolId: string };
  message: string;
  suggestion?: string;
  fix?: { kind: "replaceToken" | "replacePath"; from: string; to: string };
}
```

Lock file, `docbind.lock.json`, checked in:

```json
{
  "schema": 1,
  "engine": "0.1.0",
  "generation": 12,
  "anchors": [
    {
      "docPath": "docs/api.md",
      "contextFp": "9f2c7d1a",
      "token": "getUser",
      "occurrence": 0,
      "symbolId": "app|src/users|function|getUser|0",
      "kind": "function",
      "shapeHash": "a71e4c02",
      "confidence": 0.82
    }
  ],
  "tombstones": [
    {
      "symbolId": "app|src/users|function|fetchUser|0",
      "name": "fetchUser",
      "qualifiedName": "app.users.fetchUser",
      "kind": "function",
      "shapeHash": "5b9d1100",
      "removedInGeneration": 11,
      "renamedTo": "app|src/users|function|getUser|0"
    }
  ]
}
```

Rules:

- Anchors sort by `docPath`, `contextFp`, `token`, `occurrence`. Stable serialization, two-space indent, trailing newline.
- Tombstones prune after three generations. A tombstone survives while a live anchor references its `symbolId`, computed before dropping edited anchors.
- `engine` mismatch produces a warning and a suggested `docbind lock --refresh`, not a mass failure.
- No timestamps. Reproducible output across machines and time zones.
- Confidence and shape are frozen. `check` never writes the lock.

Tombstones are the only history the tool needs. Git history is used for rename candidates, not for correctness.

---

## 7. Discovery

Defaults:

- Include `README.md`, `docs/**/*.md`, `**/*.md` under package roots.
- Exclude `.git`, `node_modules`, `vendor`, `dist`, `build`, `target`, `.venv`, `site`, `_build`.
- Exclude `CHANGELOG*`, `HISTORY*`, `releases/**`, `docs/migration*`, `docs/upgrade*` by default. Overridable per path, but opting in is explicit.
- Exclude generated docs: first 5 lines contain `generated`, `do not edit`, `autogenerated`, or a matching frontmatter flag. Generated docs get regenerated, so a finding is noise.
- Skip symlinks outside the repo root.
- Respect `.gitignore` unless `--no-ignore`.

Package roots come from the nearest `package.json`, `pyproject.toml`, `Cargo.toml`, or `go.mod`. A symbol's package is the root that owns its file. Doc files get the nearest package for resolution scope.

Monorepo default: bare names resolve within the doc's package first. A bare name with no match in scope may resolve across packages only if it is unique in the workspace. Cross-package docs should use qualified names or imports. If the same name exists in two packages and no import evidence exists, the anchor stays unbound.

---

## 8. Code surface extraction

Extractor protocol: `docbind-extract --root <path> --json` writes `Symbol[]` to stdout. Errors go to stderr and never fail the whole run. The core consumes the same schema for every language, so adding a language does not touch the diff engine.

Cache under `.docbind/cache/`, keyed by content hash plus extractor version. Cache is local and gitignored.

### TypeScript and JavaScript

Use `ts.createSourceFile` per file. No `Program`, no type checker, no `node_modules` resolution. Syntactic exports are enough for symbol identity.

Handle:

- `export function`, `export class`, `export const`, `export interface`, `export type`, `export enum`, `export namespace`.
- `export { a, b as c }` and `export { a } from "./mod"`.
- `export * from "./mod"` and `export * as ns from "./mod"`. Collapse chains to the defining symbol, add the public alias.
- Barrel files: a public path may differ from the defining module. The symbol ID uses the defining module, and the public path becomes an alias. A doc using the barrel path binds to the same symbol, so an internal file move does not create a finding if the barrel re-export still works.
- Overload sets: one symbol per overload, plus a parent "overload set" shape used when a doc claim's arity matches any member.
- Declaration merging: merge interfaces and namespaces by name and module.
- `export =` and `export default`. Default exports have the name `default` and bind to `default` or to the doc's inferred name only through an import table.
- Class members: exported as child symbols (`Parent.method`, `Parent.property`). A doc mentioning `Client.request` binds to the member.
- Decorators that change the contract: `@property`, `@staticmethod`, `@readonly`, `@deprecated`. Unknown decorators are ignored, not hashed.
- `.d.ts` files: included as declarations. A doc binding to a type-only export is valid.

JavaScript: same extractor, no TS types. Shape falls back to arity, parameter names, defaults, rest, async, and generator. Document that JS shape detection is weaker and that JSDoc types are not read in v1.

Parameter names are excluded from `shapeHash` and collected into `paramNamesHash`.

### Python

Spawn `python -m griffe dump <package> --json` and adapt the result. Griffe already handles:

- `__all__` and re-exports.
- Aliases and `from x import y as z`.
- `@overload`, `@property`, `@classmethod`, `@staticmethod`.
- Positional-only and keyword-only parameters.
- Async functions.
- Class attributes and dataclass fields (where statically visible).

Do not reimplement Python import resolution. Griffe's output is the reference. If griffe is missing, the Python extractor reports a clear setup error and the rest of the run continues with Python files unbound rather than crashing.

`shapeHash` for Python includes parameter kinds, annotation text (canonicalized), defaults presence, return annotation, async, decorators that change the contract, and class bases. It excludes parameter names and bodies.

### Rust and Go

Deferred to M7. The protocol and shape model are designed now so they can be added without core changes.

Rust: syntactic `syn` helper by default. `rustdoc` JSON only with `--allow-build`, for the security reason in section 4. Re-export chains through `pub use` collapse to the defining item. Lifetimes, generics, where clauses, `self` receiver, `mut`, `unsafe`, and `async` are part of the shape.

Go: `go/packages` extractor, opt-in. Exported identifiers, methods, struct fields, interface methods, type parameters.

### Shape canonicalization

The goal is a string that changes when the public contract changes and stays stable under formatting, comments, and renames that do not matter.

Function shape:

```text
fn|async=0/1|gen=0/1|tp=<hash>|params=[<type>:<optional>:<rest>:<default>]|ret=<hash>|throws=<hash>|vis=<public/protected/private>|flags=<sorted>
```

Class shape:

```text
class|abstract=0/1|tp=<hash>|extends=<hash>|implements=<sorted hashes>|members=<sorted member shape hashes>
```

Type and interface shape: sorted member entries of `name:optional:typeHash`, plus index signatures and call signatures.

Const shape: declared type hash plus literal kind. A const value change is not a finding unless the doc token appears in a signature fence that asserts the value, which v1 does not support. Enum member values are included because docs often quote them.

Excluded from every shape: parameter names, bodies, comments, formatting, non-contract decorators, and attributes such as `#[inline]`. Included: visibility, async, generator, abstract, readonly, static, mutability, receiver, deprecation.

`shapeHash` is `sha256(canonicalShape)` truncated to 16 hex characters. The full canonical string is stored in the cache and attached to `explain` output, never in the lock.

---

## 9. Doc surface extraction

Parse with `mdast-util-from-markdown` plus GFM. Every node has `position.start` and `position.end`.

Bindable surfaces:

| Surface | Example | Notes |
|---|---|---|
| inline code in a paragraph | `getUser(id)` in backticks | Primary surface |
| inline code in a heading | a heading containing backticked `getUser()` | Strong claim, same scoring |
| inline code in a table cell | backticked `getUser` in a cell | Common in API tables |
| fenced code token | `const u = getUser(id)` | Uses fence imports and local declarations |
| signature fence | `function getUser(id: string): User` | Compared directly to the real signature |
| explicit reference | `{@link getUser}`, Sphinx role, `seealso getUser` | Brokenness checked even without a tombstone |

Not bindable in v1:

- Plain prose names without backticks.
- Unlabeled fences and `text`, `console`, `bash`, `sh`, `shell`, `json`, `yaml`, `toml`, `html`, `css` fences.
- HTML blocks and comments.
- Frontmatter.
- Inline code inside link URLs or image alt text.
- Inline code inside blockquotes that quote historical material. Detect via `>` ancestry plus negative context cues.

An author can force binding inside an otherwise ignored fence with a leading comment `docbind:lang=ts`.

### Fence parsing

For a fence with a supported language:

1. Parse the whole fence with the language parser.
2. Extract imports from the fence into `importTable`.
3. Extract declarations into `localDecls`.
4. Visit identifier and type references. Bind each against `importTable` first, then project exports.
5. Mark the fence as `fragment` if it contains elisions (`// ...`, `# ...`, `/* ... */`, `...`) or parse errors. Fragments get a 0.20 confidence penalty and are never used for signature comparison.

A fence that parses to exactly one declaration and nothing else becomes a `signatureFence`. Its declared signature is canonicalized and compared to the current symbol using the same compatibility lattice. This is the most valuable check because it catches return type and parameter changes that a name-only tool misses.

Fence imports are also used for inline spans in the same section. A code block that imports `getUser` from `./users` immediately above an inline `` `getUser` `` gives that span a strong binding.

### Context fingerprint

Purpose: detect doc-side edits without treating an unrelated paragraph as a rewrite.

```text
context = normalize(text of nearest heading + "\n" + text of the anchor's paragraph)
normalize: NFKC, replace the anchor span with "<ref>", collapse whitespace, trim
contextFp = sha256(context).slice(0, 16)
```

Replacing the span with `<ref>` means a corrected token keeps the same context fingerprint, so the tool sees the same sentence with a new claim. Moving a paragraph within a file does not change the fingerprint. Editing the sentence does.

For list items, the paragraph is the list item text. For headings, the context is the heading plus the first paragraph after it. For table cells, the context is the header row plus the row text.

### Negative cues

If one of these appears within three lines of the anchor, the anchor is not a live claim:

`deprecated`, `removed`, `renamed`, `renames`, `no longer`, `formerly`, `was called`, `before v`, `in v1`, `migration`, `breaking change`.

The list is configurable only by the tool, not per repo. Per-repo tuning destroys comparability across projects.

### Explicit references

Parse `{@link foo}`, `{@linkcode foo}`, Sphinx `:func:`, `:class:`, `:meth:`, `:attr:`, `:mod:`, and `seealso` blocks. These are claims by construction. If the target does not resolve, report L1 even without a tombstone. This is the one exception to I2, and it is safe because the author opted into reference syntax.

---

## 10. Resolution and scoring

Resolution order, first hit wins for candidate generation, but every candidate is scored:

1. Fence import table match.
2. Section import mention within the same section or the preceding 30 lines.
3. Qualified name exact match (`pkg.mod.Name`, `crate::mod::Name`, `Class.method`, `module.Name`).
4. Alias table match.
5. Unique exact export name in package scope.
6. Unique exact export name in workspace scope.

Case-insensitive matches are recorded for `explain` only and never bind.

### Score

Weights are provisional until M4 calibration. They live in the engine, not in repo config.

| Evidence | Delta |
|---|---|
| resolved via fence import | +0.50 |
| explicit reference syntax | +0.50 |
| qualified name exact | +0.45 |
| unique exact export name | +0.35 |
| resolves via alias | +0.30 |
| call form and arity matches an overload | +0.20 |
| unique in workspace | +0.15 |
| API-shaped doc path or section heading | +0.10 |
| same binding appears elsewhere in the repo | +0.10 |
| two or more equal candidates | -0.35 |
| shadowed by a declaration in the same fence | -0.60 |
| fragment fence | -0.20 |
| token length 2 or less | -0.20 |

Bind threshold: 0.70. Rename suggestion threshold: 0.80 plus shape similarity 0.95.

Only anchors at or above 0.70 enter the lock. A low-confidence binding never exists, so it can never become a finding. This is I2 in mechanical terms.

### Hard vetoes

Applied before scoring, independent of the result:

- Contains whitespace and does not parse as a signature.
- URL, email, IP address with port, or a string starting with `http://`, `https://`, `ssh://`, `git@`.
- Filesystem path (`/`, `./`, `../`), file name with an extension, or glob.
- Semver, version range, date format, duration, byte size.
- Regex or glob metacharacters without a code parse.
- Hex color, base64 blob, UUID, hash.
- CLI flags (`--foo`, `-abc`) or shell command shape.
- HTTP method plus path, MIME type, encoding name.
- Environment variable shape (`[A-Z][A-Z0-9_]{2,}`) that did not resolve to a const or enum member.
- Reserved word in the fence language.
- Universal prose words: `install`, `usage`, `example`, `default`, `optional`, `required`, `true`, `false`, `null`, `none`, `undefined`, `error`, `result`, `data`, `config`, `value`, `name`, `string`, `number`, `boolean`, `object`, `array`, `file`, `path`, `main`, `test`, `build`, `start`, `stop`.

The prose word list is the last line of defense, not the first. Resolution and thresholds do most of the work. A name like `install` that is also an exported symbol should bind only with import evidence or call form plus API context, which the score handles without a special case.

### Ambiguity

Two candidates within 0.05 of each other, or the same name in two packages without import evidence, produce `unbound(reason=ambiguous)`. `check` ignores it. `--all` shows it as a note. `explain` lists both candidates.

Never break a tie by file proximity or recent edits. A wrong binding creates a wrong finding, and a wrong finding costs more trust than a missed one.

### Fresh binding

A token not present in the lock may bind for the first time. It produces no finding. It gets added to the lock only when the run is `docbind lock`, or when `check` runs with `--update-lock` in local mode. CI never writes.

---

## 11. Diff engine

The key for a doc claim:

```text
key = docPath + "\0" + contextFp + "\0" + token + "\0" + occurrence
```

Line numbers are not part of the key, so moving a paragraph keeps the binding.

Algorithm:

```text
function check(lock, code, docs):
  byKey = index(docs.anchors, key)
  findings = []
  referenced = set()

  for entry in lock.anchors:
    referenced.add(entry.symbolId)
    live = byKey.pop(key(entry))
    if live == null:
      continue                    # doc edited, moved, or removed: claim withdrawn
    sym = code.byId[entry.symbolId]
    if sym == null:
      findings.push(renameOrBroken(entry, code))
      continue
    delta = compare(entry.shapeHash, sym.shapeHash)
    if delta.breaking:
      findings.push(reshapedOrMoved(entry, sym, delta))
    # additive and neutral deltas leave the lock untouched

  for anchor in byKey.values():
    if anchor.surface == "explicitRef":
      bindStrict(anchor, code) or findings.push(broken(anchor))
    else if tombstoneMatches(anchor, lock.tombstones):
      findings.push(brokenOrRenamed(anchor, lock.tombstones))
    else:
      binding = bind(anchor, code, docs)
      if binding.confidence >= BIND_THRESHOLD:
        pending.push(binding)     # new claim, no finding

  pruneTombstones(lock, referenced)
  return findings, pending
```

`compare` returns a delta with a classification, not a boolean:

| Change | Class | Result |
|---|---|---|
| add optional parameter | additive | silent |
| add overload | additive | silent |
| widen return union | additive | silent |
| add optional field | additive | silent |
| add enum variant | additive | silent |
| add required parameter | breaking | L3 |
| remove parameter | breaking | L3 |
| narrow parameter type | breaking | L3 |
| change return type incompatibly | breaking | L3 |
| change sync to async or back | breaking | L3 |
| add a thrown error | breaking | L3 |
| make an optional parameter required | breaking | L3 |
| remove an overload that matched the doc's arity | breaking | L3 |
| remove a field or enum variant | breaking | L3 |
| rename a parameter | soft | L3 only for call-form or signature-fence claims |
| add deprecation | signal | S1, off by default |
| body change with same shape | none | silent |
| comment or formatting change | none | silent |

### L1, L2, L3, L4

L1 broken: the symbol is gone and no rename candidate passes the threshold.

L2 moved: the symbol exists, but the qualified path in the doc no longer resolves. A bare name that still resolves through a re-export is not stale. Module moves are only findings when the doc wrote the path.

L3 reshaped: the symbol exists and the claimed shape is incompatible with the current shape. The finding includes the concrete difference.

L4 renamed: the symbol is gone, and a candidate has shape similarity at least 0.95 and body similarity at least 0.60. The finding carries a fix.

Severity: L1 through L4 are errors. S1 is a warning and off by default. Everything heuristic-only is a note.

### Lock update semantics

`check` never writes. `lock` writes new claims and refreshed shapes after doc edits.

A code change alone usually does not modify the lock:

- Additive shape changes are ignored because the lock keeps the doc's baseline.
- Breaking changes produce findings and leave the lock alone until the doc is fixed.
- A doc edit changes the context fingerprint, so the old key disappears, the new anchor re-binds, and the lock entry updates in the same run that fixes the doc.

This keeps lock churn aligned with doc churn, not code churn. A maintainer updates the lock after changing docs, not after every refactor.

If the engine version changed, `check` prints one warning. `docbind lock --refresh` recomputes every entry once, with a summary of how many bindings were dropped. Review that diff before committing it.

---

## 12. Rename and move inference

Candidates come from three sources:

1. AST diff between the merge-base tree and the working tree: removed declarations on one side, added declarations on the other.
2. Same module, same kind, edit distance on the name.
3. Same shape hash anywhere in the workspace.

Score:

```text
renameScore = 0.50 * shapeSimilarity
            + 0.25 * bodySimilarity
            + 0.15 * nameSimilarity
            + 0.10 * sameModule
```

Accept only when `shapeSimilarity >= 0.95` and `bodySimilarity >= 0.60` and `renameScore >= 0.80`.

Shape similarity is the Jaccard index over canonical shape tokens. Body similarity is the Jaccard index over normalized identifier and literal tokens in the body. Name similarity uses normalized Levenshtein distance on the unqualified name.

No suggestion below the threshold. "Removed, here is the closest guess" is worse than "removed". A wrong rename fix rewrites a correct doc into a wrong one.

Git's file rename detection is not enough. Move a function between files, and git sees a modified file with no rename. The AST diff catches it.

For L2, the suggested fix rewrites only the path segments that no longer resolve. If the old path was `app.users.fetchUser` and the module moved to `app.accounts`, the fix replaces `users` with `accounts` only when the final segment still resolves to the same symbol ID. Otherwise it is L1.

---

## 13. CLI, config, and reporting

Commands:

```text
docbind init
docbind check [--changed-only] [--all] [--json] [--sarif <file>] [--strict] [--explain]
docbind lock [--check] [--refresh]
docbind fix [--write] [--rule L4]
docbind explain <doc>:<line>[:<column>]
docbind stats
```

`init` writes `docbind.json` and an initial lock. `check` is read-only. `fix` without `--write` prints a diff. `explain` resolves one anchor and prints every candidate with its score and vetoes.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | clean |
| 1 | findings at or above the configured severity |
| 2 | config, IO, or parse failure that prevents a trustworthy run |
| 3 | lock is out of date (`lock --check`) |

A parse failure in one file is not exit 2. It degrades binding for that file and appears in `stats`. Exit 2 is reserved for a run that cannot be trusted at all.

Config, `docbind.json`:

```json
{
  "$schema": "https://docbind.dev/schema/config.json",
  "docs": ["README.md", "docs/**/*.md"],
  "exclude": ["CHANGELOG.md", "docs/migration/**"],
  "packages": ["packages/*"],
  "languages": {
    "typescript": true,
    "python": false,
    "rust": false
  },
  "severity": {
    "L1": "error",
    "L2": "error",
    "L3": "error",
    "L4": "error",
    "S1": "off"
  },
  "maxFindings": 200
}
```

Thresholds, weights, and the negative cue list are not configurable per repo. Letting teams lower the bar turns a precision tool into a noise generator and makes published benchmarks meaningless.

Human output:

```text
docs/api.md:42  error  L4  `getUser` was renamed to `get_user`
  code: src/users.ts:88
  fix:  docbind fix --write

docs/api.md:77  error  L3  `createUser(name, email)` no longer accepts `email`
  code: src/users.ts:14
  old:  (name: string, email: string) => User
  new:  (input: CreateUserInput) => User
```

JSON output is an array of findings plus a summary object with counts, bind rate, parse failures, and engine version.

SARIF: one rule per finding code, `physicalLocation` on the doc span, `relatedLocations` on the code declaration, `partialFingerprints` set to the finding ID. GitHub code scanning then deduplicates across line moves.

GitHub Action: composite action that runs `npx docbind@<version> check --sarif docbind.sarif` and uploads the SARIF file. The action pins a major version. No network at check time except the npm install that the action performs.

`--changed-only` limits docs and code to files changed against `git merge-base HEAD origin/HEAD`, plus reverse import dependents for re-exports. It is a local speed feature, not a correctness mode.

`maxFindings` stops output floods. When the cap is hit, the tool says so and exits 1. A repo with hundreds of findings is a failed adoption, not a successful scan.

---

## 14. Fix engine

Fixable in v1:

- L4 rename: replace the token text inside its span.
- L2 moved path: replace the stale path segment inside its span.

Not fixable: L3 shape changes. Rewriting a signature or a call example changes meaning, and a tool should not guess.

Rules:

- Preserve everything outside the span byte for byte, including CRLF and tabs.
- Refuse if the span is inside a link destination, an HTML attribute, or a fence marked `docbind:no-fix`.
- Refuse if the token appears more than once in the span.
- Preserve the case style of the original token when the replacement is a straight rename: `getUser` to `get_user` follows the target name exactly, never the source casing.
- After writing, update the lock in the same command and re-run `check`. If findings remain from the fixed rules, exit 1.
- Running fix twice changes nothing.

No backups. Git is the backup. Print the changed file list.

---

## 15. False-positive program

Precision is the product. Recall without precision gets the tool disabled in a week.

### Mechanisms

1. Resolution-first. Unresolvable tokens are invisible.
2. Tombstone-gated brokenness. "Missing" only matters if it used to exist.
3. Confidence floor. Low-confidence binds never enter the lock.
4. Ambiguity silence. Ties never fail CI.
5. Additive compatibility lattice. Most real commits change nothing that matters.
6. Historical doc exclusion. Old names in changelogs are correct.
7. Negative context cues. A sentence about a removal is not a stale claim.
8. Fence imports and local declarations. A snippet's own variables are not doc references.
9. Explicit reference syntax only for fresh brokenness.
10. Locked shape baseline. Additive code churn cannot create a finding.

### Adversarial fixture corpus

Every item below is a doc snippet that must produce zero findings, even when the repo exports a symbol with a similar name.

- `npm install`, `cargo add serde`, `git rebase -i`
- `true`, `false`, `null`, `None`, `undefined`
- `GET /users`, `POST /users/:id`, `HTTP 404`
- `v2.0.0`, `^1.2.3`, `2026-11-03`, `10ms`
- `*.ts`, `src/**/*.md`, `README.md`, `./config.json`
- `#fff`, `0x1f`, `UTF-8`, `application/json`
- `https://example.com`, `user@example.com`, `localhost:3000`
- `FOO_BAR`, `NODE_ENV`, `--no-verify`, `-abc`
- `\d+`, `[a-z]+`, `foo bar`
- `Array<T>`, `Promise<User>`, `Record<string, unknown>`
- `` `install` `` in a README where the repo exports `install`
- `` `serve` `` in prose where the repo exports `serve`
- `` `main` `` in "the main entry point"
- `` `error` `` in an error-handling guide
- `` `getUser` `` inside a sentence that says it was removed in v2
- `` `getUser` `` inside a fenced shell block
- `` `getUser` `` inside an unlabeled pseudo-code fence
- `` `client` `` inside a fence that declares `const client = ...`
- `` `User` `` in a JSON fence
- `` `path` `` in a YAML fence

Each case becomes a fixture with a comment explaining why it is adversarial. The fixture passes only when the finding count is zero.

### Labeled corpus

Fetch 10 open-source repos with hand-written docs, at a pinned commit. For each:

1. Run `docbind lock` at commit C.
2. Run `docbind check` over the next 20 commits.
3. Collect findings.
4. Label each finding true or false by reading the diff and the doc.
5. Record misses from seeded mutations separately.

This measures real precision. Synthetic mutations measure recall. Both numbers go in the README and the release notes, with the corpus commit hashes.

Target: at most 2 false findings per 100 findings. If the corpus produces more, M4 does not ship.

### Precision regressions

Every false positive found in the wild becomes a fixture in the same commit as the fix. The fixture name is the issue number. No exceptions.

`docbind explain` exists for this workflow. It prints why a token did or did not bind, which turns a bug report into a reproducible case without guesswork.

---

## 16. Testing

### Fixture layout

```text
test/fixtures/rename-function/
  v0/src/users.ts
  v0/docs/api.md
  v1/src/users.ts
  v1/docs/api.md
  expect.json
```

`expect.json` holds findings and the expected exit code. Tests snapshot the finding IDs, not the prose. A structure test asserts that every finding has a doc location, a rule, and a message.

### Mutation harness

Generate 20 mutation types against a fixture repo. Each mutation targets one doc anchor and has an expected rule.

1. Remove export.
2. Rename export.
3. Move export to another module.
4. Change parameter type.
5. Add required parameter.
6. Remove optional parameter.
7. Change return type.
8. Make function async.
9. Remove matching overload.
10. Rename parameter (soft).
11. Add optional parameter (must be silent).
12. Widen return union (must be silent).
13. Add enum variant (must be silent).
14. Add optional field (must be silent).
15. Remove field.
16. Add deprecation flag (S1, off by default).
17. Change const type.
18. Change class base.
19. Change receiver mutability (Rust).
20. Change Python keyword-only marker.

Each mutation also runs against every unrelated doc anchor and must produce no findings there. That is the precision half of the harness.

### Property tests

- `check` on a clean tree is empty, for every fixture pair where v0 equals v1.
- `fix` is idempotent.
- `fix` then `check` is clean for L4 fixtures.
- Serialization round-trips the lock without byte changes.
- Every finding ID is stable across line moves.
- Parsing a truncated file never throws.

### Performance

Synthetic repo: 5,000 TS files, 1,000 markdown files, 10,000 anchors. Budget: cold under 10s, warm under 2s. Profile the markdown pass and resolution separately. If the budget is missed, cache parsed docs by content hash before optimizing resolution.

### CI matrix

Node 20, 22, and 24 on Linux and macOS. Windows runs the unit suite but not the timing suite. Python extractor tests run only when Python and griffe are available.

---

## 17. Milestones

Rough effort for one developer. Precision work is open-ended, so treat these as sequencing with estimates, not commitments.

| Milestone | Scope | Exit gate | Days |
|---|---|---|---|
| M0 | Prior art sweep, name check, spec review, fixture skeleton | A named list of checked tools with their gaps; no blocking prior art; npm name available | 3 |
| M1 | TS extractor, mdast anchors, exact-name resolution, JSON output, no lock | Runs on 5 repos; manual review says at least 70% of findings are real; no crashes | 5 |
| M2 | Lock, three-way diff, tombstones, rename inference | Zero findings on 10 unchanged repos; 90% recall on L1 and L4 mutations | 5 |
| M3 | Shape hashing, compatibility lattice, signature fences, L2/L3 | 15 additive fixtures silent; 20 breaking fixtures detected; signature diffs render correctly | 5 |
| M4 | Precision hardening, labeled corpus, explain mode, release benchmark | At most 2% false findings on the corpus; precision report published with commit hashes | 7 |
| M5 | Python extractor through griffe, plugin protocol hardening | Parity with TS on the fixture matrix for functions, classes, aliases, overloads | 5 |
| M6 | Fix engine, SARIF, GitHub Action, self-dogfood, one pilot repo | Pilot CI green; one real stale doc fixed by the tool; own docs pass | 4 |
| M7 | Rust syntactic extractor, Go opt-in extractor, docs site | Extractor protocol proven by two more languages; no core changes needed | 8 |

Total: roughly 42 engineer-days, or eight working weeks solo, plus pilot feedback. M4 is the risky one. If the corpus precision gate fails, the schedule moves, not the gate.

### M0 prior art list

Check these categories and record the gap in `docs/prior-art.md`:

- Doc generators: TypeDoc, pydoc-markdown, rustdoc, mdBook, MkDocs, Docusaurus.
- Link checkers: lychee, Docusaurus broken link detection, markdown-link-check.
- Prose linters: Vale, textlint, alex.
- Docstring linters: eslint-plugin-jsdoc, pydocstyle, ruff's docstring rules.
- Snippet runners: pytest-codeblocks, doc-detective, mdbook test.
- Code search and refactoring: Sourcegraph, tsserver rename, gopls rename, rust-analyzer rename.
- Package audit sources: the 2026 audit itself, plus any npm or crates.io packages named around "doc drift" or "doc sync".

Search terms: "markdown symbol reference", "doc code drift", "documentation staleness", "doc binding", "stale docs checker", "exported symbol documentation check".

If a tool already stores bindings and diffs contracts, the project pivots to the missing piece (rename inference, signature fences, or the lock format) rather than rebuilding the whole pipeline.

### Name check

`docbind` on npm, GitHub, and crates.io. If taken, fall back to `docanchor`, `refdrift`, or `stalebind`. The binary name matters more than the package scope. Do not spend more than an hour on this.

---

## 18. Risks

| Risk | Trigger | Mitigation | Tripwire |
|---|---|---|---|
| Precision collapse | Generic names bind to unrelated prose | Threshold, lock freeze, ambiguity silence, labeled corpus | More than 2 false findings per 100 on the corpus |
| Silent tool | Bind rate too low on real docs | Fence imports, signature fences, explicit refs, API-context cue | Bind rate under 20% on the corpus |
| Lock churn | Every code change touches the lock | Store the doc's baseline shape; ignore additive deltas | Lock diff in a code-only PR |
| Merge conflicts | Two docs edited in one lock region | Deterministic sort; document `docbind lock` as the resolution | More than one conflict per week in a pilot |
| Parser drift | Grammar changes break extraction silently | Pin parser versions; fixture per language construct; parse-failure stats | Parse failures above 1% of files |
| Monorepo ambiguity | Same name in several packages | Package scoping, import evidence required | Ambiguous anchors above 10% |
| Untrusted code execution | Rust or Go extractor runs project build | Syntactic default, `--allow-build` opt-in | Any extractor spawning a build without the flag |
| Generated docs | Findings on files that will be overwritten | Detect markers and skip | Finding in a generated file |
| Scope creep into doc generation | Users ask for coverage reports | Keep coverage as a separate stats command, never a CI gate | A feature that writes prose |
| Audit claim wrong | A tool already solves this | M0 gate and pivot plan | Blocking prior art found |

---

## 19. Open decisions

Defaults stand unless changed before M1.

1. Lock file checked in. Default yes. It enables the three-way diff, keeps CI fast, and makes grandfathering possible. Teams that refuse it can use `--since <rev>`, which derives the baseline from the merge-base tree and is slower but lock-free.
2. TypeScript first. Default yes. Python at M5. TS gives the fastest path to a credible benchmark because mdast and the TS compiler share a runtime.
3. npm distribution. Default yes. A single binary is a later concern. CI has Node.
4. Error-only CI output. Default yes. `--all` for local review and `--strict` as an opt-in for teams that want notes to fail.
5. Syntactic contracts. Default yes. No type checker, no build, no project code execution. The tool compares canonical syntax, not inferred types.
6. No per-repo threshold tuning. Default yes. The engine version carries calibration. Teams can ignore specific finding IDs, not lower the bar.

---

## 20. First tasks

1. Run the M0 prior art sweep and write `docs/prior-art.md` with one paragraph per tool.
2. Check the name on npm and GitHub.
3. Write `docs/spec.md` by moving sections 2, 3, and 15 of this plan into a shorter specification with the invariants numbered.
4. Scaffold `package.json`, `tsconfig.json`, `src/cli.ts`, and `src/config.ts`.
5. Build the TS extractor against the `Symbol` interface. Start with `export function` and `export class`.
6. Build the markdown parser and print every `inlineCode` with position and context fingerprint.
7. Implement exact-name resolution with the score table. Do not add the lock yet.
8. Run on five real repos. Read every finding by hand. Record the false positives and why they happened.
9. Add the lock and the three-way diff. Re-run the clean-run invariant on ten repos.
10. Add the mutation harness before adding more languages.

The order matters. Precision evidence comes before feature breadth. A tool that is silent and correct earns trust. A tool that finds everything and is wrong half the time gets removed from CI.
