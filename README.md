<p align="center">
  <img src="assets/mark.svg" width="92" height="92" alt="docbind mark">
</p>

<h1 align="center">docbind</h1>

<p align="center">Catch stale symbol references in markdown.</p>

<p align="center">
  <a href="https://github.com/vindeckyy/docbind/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/vindeckyy/docbind/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/vindeckyy/docbind/actions/workflows/docs.yml"><img alt="Docs" src="https://github.com/vindeckyy/docbind/actions/workflows/docs.yml/badge.svg"></a>
  <img alt="Line coverage" src="https://img.shields.io/badge/lines-99.32%25-brightgreen">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

Markdown docs name symbols. Code renames them. `docbind` reports the mismatch.

It binds symbol-shaped inline code to exported code symbols, stores the contract shape in `docbind.lock.json`, and reports only cases where the code changed and the sentence did not.

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
- [Precision model](#precision-model)
- [Install](#install)
- [CLI](#cli)
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
markdown ──> anchors ──┐
                       ├──> resolve ──> diff(lock, code, docs) ──> findings
code ──────> symbols ──┘
```

1. Extract exported symbols from source.
2. Parse markdown and collect inline code, headings, tables, fenced code, signature fences, and explicit references.
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

Go is opt-in. Set `"go": true` in `docbind.json`.

The rustdoc extractor is also opt-in. It runs `cargo +nightly rustdoc --output-format json`, which executes build scripts and proc macros. Enable it only on trusted code.

Rust and Go extraction is syntactic. No cargo build, proc macros, cgo, or generated bindings.

## Precision model

The tool errs toward silence. A wrong finding costs more trust than a missed one.

- Binding needs a confidence score of at least 0.70.
- Ambiguous symbols never fail CI.
- Prose words, URLs, paths, versions, flags, globs, and regexes are vetoed before scoring.
- Historical context cues such as "removed", "renamed", and "migration" withdraw a claim.
- The lock freezes confidence. Low-confidence bindings never enter it.
- `docbind explain` shows every candidate, score, and veto.

The full design is in [docs/architecture.md](docs/architecture.md).

## Scope and limits

`docbind` checks symbol contracts, not prose claims. A doc sentence that names `getUser` binds the symbol. The tool verifies that the symbol still exists and that its parameters and return type still match. It does not check what the sentence says about them: a line claiming `getUser` returns `Email` passes while the signature returns `string`.

Markdown is the only input format. `docbind` reads inline code, headings, tables, fenced code, signature fences, and explicit references from markdown files. Docstrings, reStructuredText, AsciiDoc, and Javadoc are not read.

It does not execute anything. Examples are parsed, never run. Example-output drift, such as a printed value that no longer matches the code, is invisible.

## Install

The `docbind` npm name is held by an unrelated package. Install from source for now.

```sh
git clone https://github.com/vindeckyy/docbind.git
cd docbind
npm ci
npm run build
npm link
docbind init
docbind check
```

Commit `docbind.lock.json`. Run `docbind lock` after changing docs.

A scoped npm package is reserved as `@vindeckyy/docbind` but is not published yet.

## CLI

```text
docbind init
docbind check [--json] [--sarif <file>] [--github] [--all] [--strict] [--changed-only] [--base <rev>]
docbind lock [--check] [--refresh]
docbind fix [--write]
docbind explain <doc>:<line>[:<column>]
docbind stats
```

| Exit code | Meaning |
|---|---|
| 0 | clean |
| 1 | findings at or above the configured severity |
| 2 | config, IO, or parse failure that prevents a trustworthy run |
| 3 | lock is out of date |

`check` is read-only. `lock` updates the baseline. `fix` rewrites safe renames and moved paths only.

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
    "S1-deprecated": "off"
  },
  "maxFindings": 200
}
```

Thresholds and scoring weights are fixed in the engine. Per-repo tuning would make precision claims meaningless.

## Corpus

`corpus/repos.json` pins real repositories at exact commits. The harness measures baseline findings, bind rate, mutation recall, and collateral findings.

```sh
npm run corpus -- --only slugify
npm run corpus -- --refresh
```

The latest snapshot is in [corpus/report.json](corpus/report.json). Five pinned repositories and six local fixtures produce zero baseline findings, zero doc-edit findings, and 64 of 64 seeded mutation hits with no collateral findings. The corpus is not part of CI because it downloads external repositories.

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

## Gate results

Measured on the 0.1.41 tree:

| Gate | Result |
|---|---|
| Tests | 327 passing |
| Statements | 98.70% |
| Branches | 95.1% |
| Functions | 99.55% |
| Lines | 99.38% |
| Changed-line coverage, feature diff | 99.88% |
| Structure gate | 73 of 73 checks |
| Docs build | `mkdocs build --strict` passes |

These are repository gates, not benchmark claims. They will change as the code changes.

## Prior art

Tan, Wagner, and Treude published a detector for outdated code element references in 2022. It targets references that survive after source definitions disappear. `docbind` adds contract shapes, rename inference, a binding lock, and CI-grade precision for handwritten markdown.

See [docs/prior-art.md](docs/prior-art.md) for the honest comparison.

## License

MIT. See [LICENSE](LICENSE).
