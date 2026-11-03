# Contributing

## Setup

```sh
npm ci
npm run typecheck
npm test
```

Python extraction uses `python3` on PATH. Rust and Go extraction is built in.

## What to run before a pull request

```sh
npm run gate
```

This runs the coverage thresholds, changed-line coverage, and the structure gate. CI runs the same command and builds the package.

For a focused change:

```sh
npm test -- test/check.test.ts
npm run gate:changed -- --base HEAD~1
npm run gate:struct
```

## Project layout

| Path | Purpose |
|---|---|
| `src/surface` | Language extractors and the shared lexer |
| `src/docs` | Markdown parsing, anchors, fences, context |
| `src/resolve` | Candidate scoring, tombstones, rename inference |
| `src/shape` | Canonical contract strings and compatibility |
| `src/lock` | Lock schema, merging, serialization |
| `src/check.ts` | Three-way diff pipeline |
| `src/cli.ts` | CLI and output routing |
| `src/gates` | Changed-line and structure gates |
| `test` | Unit, fixture, integration, and corpus tests |
| `docs` | MkDocs site source |

## Adding a language

1. Add an extractor under `src/surface` that returns `Symbol[]` with the shared shape model.
2. Add a config switch and discovery pattern.
3. Add fixture tests for functions, types, aliases, visibility, and malformed input.
4. Add at least one finding integration test.
5. Run `npm run gate`.

Do not shell out to a build system for extraction. Parsing must not run project code.

## False positives

A false finding is a bug. Open an issue with:

- the doc line
- `docbind explain <doc>:<line>` output
- the code declaration
- the lock entry if one exists

Every fixed false positive needs a regression fixture in the same pull request.

## Pull requests

- Keep the change focused.
- Add tests for behavior changes.
- Update `docs/` when the CLI or configuration changes.
- Do not lower coverage or structure thresholds.
- Do not add per-repo scoring knobs. Calibration belongs to the engine.

## Commit style

Use a short imperative subject. Conventional Commits are welcome but not required.

## Conduct and security

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
