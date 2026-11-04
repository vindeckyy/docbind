<p align="center">
  <img src="assets/mark.svg" width="92" height="92" alt="docbind mark">
</p>

<h1 align="center">docbind</h1>

<p align="center">Contract drift detection for symbol references in docs.</p>

<p align="center">
  <a href="https://github.com/vindeckyy/docbind/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/vindeckyy/docbind/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/vindeckyy/docbind/actions/workflows/docs.yml"><img alt="Docs" src="https://github.com/vindeckyy/docbind/actions/workflows/docs.yml/badge.svg"></a>
  <img alt="Line coverage" src="https://img.shields.io/badge/lines-99.26%25-brightgreen">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

Docs name symbols. Code renames them. `docbind` reports the mismatch.

It binds symbol-shaped inline code to exported code symbols, stores the contract shape in `docbind.lock.json`, and reports only cases where the code changed and the sentence did not.

It is **not a documentation linter**. A green check means the references still resolve and the recorded contract shape did not break. It does not mean the prose is true. See [Scope and limits](docs/scope.md) before adopting it as a gate.

Brand new docs can bind exactly with an inline annotation:

```html
<!-- docbind: symbol=src/users.ts#getUser -->
```

Explicit annotations skip confidence scoring and ambiguity. When the symbol disappears or moves, the check fails. Once a repository has any explicit annotation, inferred findings are downgraded to notes and do not fail the build; explicit findings stay fatal. Unannotated repositories keep the previous behavior.

This is static analysis. It does not run project code, build the project, or generate docs.

```text
docs/api.md:42  error  L4  `getUser` was renamed to `get_user`
  code: src/users.ts:88
  fix:  docbind fix --write

docs/api.md:77  error  L3  `createUser(name, email)` no longer accepts `email`
  code: src/users.ts:14
```

## Contents

- [The problem](#the-problem)
- [How it works](#how-it-works)
- [Demo](#demo)
- [What it checks](#what-it-checks)
- [Supported languages](#supported-languages)
- [Scope and limits](docs/scope.md)
- [Precision model](#precision-model)
- [Install](#install)
- [CLI](#cli)
- [Audit coverage](#audit-coverage)
- [CI](#ci)
- [Configuration](#configuration)
- [Development](#development)
- [Gate results](#gate-results)
- [Prior art](#prior-art)
- [License](#license)

## The problem

Documentation tools move from code to docs. Link checkers verify URLs. Prose linters check style. Snippet runners execute examples.

None of them answer this question:

> This inline code span named an exported symbol last month. The symbol's contract changed. Did the sentence change?

A name lookup is not enough. `getUser` can still exist while its return type, required parameters, or module path changed. `docbind` compares the contract the doc last claimed with the contract the code has now.

## How it works

```text
docs ─────> anchors ──┐
                       ├──> resolve ──> diff(lock, code, docs) ──> findings
code ──────> symbols ──┘
```

1. Extract exported symbols from source.
2. Parse markdown and reStructuredText, then collect inline code, headings, tables, fenced code, signature fences, and explicit references.
3. Resolve tokens with import, qualified-name, alias, arity, and API-context evidence.
4. Store confirmed bindings with the shape the doc last asserted.
5. Compare current code with the stored shape on later runs.
6. Report breaking changes where the doc anchor did not move.

The lock keeps the doc's baseline, not the latest shape seen. Adding an optional parameter does not churn the lock. Removing that parameter later restores the doc's original claim, so the tool stays silent.

A token that never bound cannot become a finding. Brokenness comes from tombstones or explicit reference syntax, not from a missing-name lookup.

## Demo

```sh
npm run demo
```

The demo copies [`examples/basic`](examples/basic) to a temporary directory, renames a symbol, reports the stale line, fixes it, and checks again. The transcript is in [docs/demo.md](docs/demo.md).

## What it checks

| Rule | Finding |
|---|---|
| L1 | Referenced symbol no longer exists |
| L2 | Qualified path moved and no longer resolves |
| L3 | Signature or member contract changed |
| L4 | Symbol was renamed, with a conservative fix |
| S1 | Symbol is deprecated and the doc does not say so, opt-in |
| D1 | A configured doctest or example command failed, opt-in |
| D2 | A configured behavior probe failed in a Docker sandbox, opt-in |

Additive changes stay silent: a new optional parameter, an added overload, an optional field, a new enum variant, or a widened return union.

Ignored by default: plain prose names without backticks, unlabeled fences, historical docs such as `CHANGELOG.md`, migration guides, and tokens that never bound to a tracked symbol.

## Supported languages

| Language | Extractor | Default |
|---|---|---|
| TypeScript, JavaScript | TypeScript compiler API | on |
| Python | bundled `ast` worker | on |
| Rust | built-in lexer and item parser | on |
| Rust proc macros | opt-in rustdoc JSON | off |
| Go | built-in lexer and declaration parser | off |
| Java | built-in declaration parser | off (`javadoc`) |
| Any language | LSIF or SCIP index (`--index <file>`) | off |

Go is opt-in. Set `"go": true` in `docbind.json`.

The rustdoc extractor is also opt-in. It runs `cargo +nightly rustdoc --output-format json`, which executes build scripts and proc macros. It requires `--allow-exec` or `"allowExec": true`; without that, extraction is skipped with a warning. Enable it only on trusted code.

Rust and Go extraction is syntactic. No cargo build, proc macros, cgo, or generated bindings.

LSIF and SCIP indexes provide binding-only symbols: existence and location, not parameter or return shapes. They are useful for languages and monorepos where a native extractor is unavailable. A stale index is a stale binding source. `.scip` files are decoded as protobuf; other index paths are read as LSIF JSON lines.

Extractors implement a versioned in-process plugin interface (`EXTRACTOR_API_VERSION` in `src/surface/plugins.ts`) and are covered by golden snapshots and the conformance suite.

## Precision model

The tool errs toward silence. A wrong finding costs more trust than a missed one.

- Binding needs a confidence score of at least 0.60. The measured threshold sweep is in [docs/precision.md](docs/precision.md).
- Ambiguous symbols never fail CI.
- Prose words, URLs, paths, versions, flags, globs, and regexes are vetoed before scoring.
- Historical context cues such as "removed", "renamed", and "migration" withdraw a claim.
- The lock freezes confidence. Low-confidence bindings never enter it.
- `docbind explain` shows every candidate, score, and veto.

The full design is in [docs/architecture.md](docs/architecture.md).

## Scope and limits

`docbind` checks symbol contracts, not prose claims. A doc sentence that names `getUser` binds the symbol. The tool verifies that the symbol still exists and that its parameters and return type still match. It does not check what the sentence says about them: a line claiming `getUser` returns `Email` passes while the signature returns `string`.

Markdown and reStructuredText are the supported input formats. `docbind` reads inline code, headings, tables, fenced code, signature fences, and explicit references, plus RST literals, roles, and `code-block` directives. Python docstrings, AsciiDoc, and Javadoc are opt-in with `"docstrings": true`, `"asciidoc": true`, and `"javadoc": true`.

It does not execute project code by default. Examples are parsed, never run, so example-output drift such as a printed value that no longer matches the code is invisible. Rustdoc extraction is the one exception: it invokes `cargo` only with `--allow-exec`, because rustdoc JSON requires a build.

## Install

The `docbind` npm name is held by an unrelated package. A scoped package is reserved but unpublished. Zero-clone install from GitHub:

```sh
npx --yes github:vindeckyy/docbind --version
npx --yes github:vindeckyy/docbind init
npx --yes github:vindeckyy/docbind check
```

From source:

```sh
git clone https://github.com/vindeckyy/docbind.git
cd docbind
npm ci
npm run build
npm link
```

Commit `docbind.lock.json`. Run `docbind lock` after changing docs.

A scoped npm package is reserved as `@vindeckyy/docbind` but is not published yet. Docker and pre-commit instructions are in [docs/installation.md](docs/installation.md).

## CLI

```text
docbind init
docbind check [--json] [--sarif <file>] [--github] [--all] [--strict] [--unbound]
              [--mode gate|strict] [--no-lock] [--allow-exec] [--no-cache]
              [--index <index>] [--require-index] [--changed-only] [--base <rev>]
docbind lock [--check] [--diff] [--review] [--refresh]
docbind migrate [--check] [--json]
docbind fix [--write]
docbind explain <doc>:<line>[:<column>]
docbind adopt [--write] [--json] [--contract]
docbind audit [--unbound] [--json]
docbind doctest [--json]
docbind probe [--json]
docbind stats
```

| Exit code | Meaning |
|---|---|
| 0 | clean |
| 1 | findings at or above the configured severity |
| 2 | config, IO, or parse failure that prevents a trustworthy run |
| 3 | lock is out of date |

`check` is read-only. `lock` updates the baseline. `lock --check` fails when the lock is not derivable from the current docs. `lock --diff` renders semantic changes for the rebuild: added anchors, removed anchors, symbol moves, and contract changes with old/new hashes. `fix` rewrites safe renames and moved paths only.

## Audit coverage

`docbind audit --unbound` reports binding coverage and every unbound token with its reason. Unbound tokens are silent by default, so this is the audit path for false-negative risk:

```sh
docbind audit --json --unbound
```

Coverage is `bound / anchors`. It is not a claim that bound sentences are correct.

`docbind adopt` proposes explicit annotations for inferred bindings. `--write` inserts the comments above the anchored lines. Re-running it is idempotent.

`docbind check --mode=strict` fails when abstentions fall on changed lines. `--mode=gate` keeps abstentions as notes. Without git history, strict treats all abstentions as changed.

## CI

```yaml
- run: npx --yes github:vindeckyy/docbind check --sarif docbind.sarif
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: docbind.sarif
```

The repository also ships a composite action in [`action/action.yml`](action/action.yml).

## Configuration

`docbind.json` is optional.

```json
{
  "docs": ["README.md", "docs/**/*.md", "**/*.md"],
  "exclude": ["CHANGELOG.md", "docs/migration/**"],
  "languages": { "typescript": true, "python": true, "rust": true, "go": false, "rustdoc": false },
  "severity": {
    "L1-broken": "error",
    "L2-moved": "error",
    "L3-reshaped": "error",
    "L4-renamed": "error",
    "S1-deprecated": "off",
    "D1-doctest": "error",
    "D2-probe": "error"
  },
  "maxFindings": 200,
  "minConfidence": 0.6,
  "docstrings": false,
  "asciidoc": false,
  "javadoc": false,
  "lock": true,
  "allowExec": false,
  "cache": true,
  "indexes": [],
  "doctests": [],
  "probes": []
}
```

The confidence floor is `minConfidence`, default `0.6`. The weights behind it and the measured threshold sweep are in [docs/precision.md](docs/precision.md). Raising the floor trades bind rate for margin; lowering it does not add bindings on the published fixtures.

## Corpus

`corpus/repos.json` pins real repositories at exact commits. The harness measures baseline findings, bind rate, mutation recall, and collateral findings.

```sh
npm run corpus -- --only slugify
npm run corpus -- --refresh
```

The latest snapshot is in [corpus/report.json](corpus/report.json). Five pinned repositories and ten local fixtures produce zero baseline findings, zero doc-edit findings, and 131 of 131 seeded mutation hits with no collateral findings. Bind rates are published per case in [docs/corpus.md](docs/corpus.md).

Local fixtures run in CI with `npm run corpus:fixtures`, which fails on baseline findings, doc-edit noise, missed mutations, or collateral findings. External repositories stay manual because they need network access.

## Development

Requirements: Node 22.12 or newer, `python3` for the Python extractor, and MkDocs for the docs site.

```sh
npm ci
npm run typecheck
npm test
npm run coverage
npm run gate
```

`npm run gate` runs the coverage thresholds, changed-line coverage, and the structure gate.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-docs.txt
.venv/bin/mkdocs serve
```

Architecture notes live in [docs/architecture.md](docs/architecture.md). Contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Engineering guarantees

- `docbind check` does not execute project code. `cargo` for rustdoc is gated by `--allow-exec`; the threat model is in [docs/threat-model.md](docs/threat-model.md).
- Lock files carry a semver format. `docbind migrate --check` exits 3 when the lock needs upgrading; `docbind migrate` rewrites it and is idempotent.
- Surface extraction is cached in `.docbind-cache/`, keyed by engine version, extractor config, file paths, and file content hashes. `--no-cache` bypasses it.
- `npm run conformance` runs a public, language-neutral suite. `npm run corpus:fixtures` is the mutation regression gate in CI.
- `docbind lock --review` exits 3 when a lock change is not coupled to the corresponding doc line.
- `docbind doctest` runs configured commands only with `--allow-exec` and turns failures into `D1-doctest` findings. pytest, mdbook, and typedoc examples are command entries, not built-in runners.
- `docbind probe` runs configured calls in Docker with `--network none`, a read-only root, a read-only repo mount, and memory/CPU limits. Failures become `D2-probe` findings. It also requires `--allow-exec`.
- LSIF and SCIP indexes are consumed with `--index`. `--require-index` warns when no index symbols are available and native parsers are the fallback.
- Single-file binaries are built with Bun for Linux, macOS, and Windows in the release workflow. Python extraction in a binary needs the `python/` directory beside it or `DOCBIND_PYTHON_WORKER`.
- Golden extractor snapshots live in `test/golden/`.

## Gate results

Measured on the 0.2.6 tree:

| Gate | Result |
|---|---|
| Tests | 414 passing |
| Statements | 98.02% |
| Branches | 95.04% |
| Functions | 97.91% |
| Lines | 98.83% |
| Changed-line coverage, feature diff | 98.84% |
| Structure gate | 90 of 90 checks |
| Docs build | `mkdocs build --strict` passes |

These are repository gates, not benchmark claims. They will change as the code changes. Runtime measurements are in [docs/performance.md](docs/performance.md).

## Prior art

Tan, Wagner, and Treude published a detector for outdated code element references in 2022. It targets references that survive after source definitions disappear. `docbind` adds contract shapes, rename inference, a binding lock, and CI-grade precision for handwritten docs.

See [docs/prior-art.md](docs/prior-art.md) for the honest comparison.

## License

MIT. See [LICENSE](LICENSE).
