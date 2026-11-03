# docbind

Symbol-level documentation staleness detection for markdown.

`docbind` binds symbol-shaped inline code in markdown to exported code symbols. It stores each binding in `docbind.lock.json`. Later runs compare the current code shape against the shape the doc claimed. A finding means the code changed and the sentence did not.

This is static analysis, not a docs generator. No build, no execution of project code, no network.

## Install

```sh
npm install --save-dev docbind
npx docbind init
```

Or run without installing:

```sh
npx docbind check
```

## Commands

```text
docbind init
docbind check [--json] [--sarif <file>] [--github] [--all] [--strict] [--changed-only] [--base <rev>]
docbind lock [--check] [--refresh]
docbind fix [--write]
docbind explain <doc>:<line>[:<column>]
docbind stats
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | clean |
| 1 | findings at or above the configured severity |
| 2 | config, IO, or parse failure that prevents a trustworthy run |
| 3 | lock is out of date |

## What it catches

- Removed exported symbols referenced by a doc.
- Renamed symbols, with a conservative auto-fix.
- Moved qualified paths, with a path fix.
- Changed signatures: required parameters, return types, async, member removal.
- Signature fences that no longer match the real declaration.
- Deprecation, when `S1-deprecated` is enabled.

## What it ignores

- Plain prose names without backticks.
- Unlabeled and non-code fences.
- Tokens that never bound to a tracked symbol, unless they match a tombstone or use `{@link}` style syntax.
- Historical docs such as `CHANGELOG.md` and migration guides.
- Additive changes such as a new optional parameter or an added enum variant.

The precision rule is simple: a token that never bound cannot become a finding. Brokenness comes from the lock history, not from a name lookup.

## Precision and coverage

The tool targets 95% line coverage on its own source, 95% changed-line coverage, and a 95% structure gate.

```sh
npm test
npm run coverage
npm run gate:changed -- --all
npm run gate:struct
npm run gate
```

Changed-line mode compares `coverage/lcov.info` against a git diff:

```sh
npm run gate:changed -- --base origin/HEAD
```

The structure gate checks required files, exports, scripts, forbidden test markers, per-file coverage, and the Python extractor entry point.

## Configuration

`docbind.json` is optional. Defaults work for most repositories.

```json
{
  "docs": ["README.md", "docs/**/*.md", "**/*.md"],
  "exclude": ["CHANGELOG.md", "docs/migration/**"],
  "languages": { "typescript": true, "python": true },
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

Thresholds and scoring weights are fixed in the engine. Per-repo tuning makes published precision numbers meaningless.

## How it works

1. Extract exported symbols from TypeScript, JavaScript, and Python.
2. Parse markdown and collect inline code, fenced code, signature fences, and explicit references.
3. Resolve tokens with import, qualified-name, alias, and score evidence.
4. Store confirmed bindings with the code shape at claim time.
5. On later runs, compare the current shape with the stored shape.
6. Report only breaking changes where the doc anchor did not move.

The lock keeps the shape the doc last asserted, not the latest shape seen. Additive code changes therefore do not churn the lock.

## Limitations

- Shape comparison is syntactic. It does not type-check or evaluate generics.
- Illustrative snippets with elisions get a confidence penalty.
- Python support uses a bundled `ast` worker and requires `python3` on PATH.
- Rust and Go are not implemented yet.
- A doc that was rewritten loses its old binding. Tombstones cover recent removals, not ancient history.

## License

MIT.
