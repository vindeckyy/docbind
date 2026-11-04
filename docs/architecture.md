# Architecture

The pipeline has six stages.

1. Discover docs and code.
2. Extract exported symbols.
3. Parse markdown anchors.
4. Resolve anchors to symbols with evidence and a confidence floor.
5. Diff the lock, current code, and current docs.
6. Report, fix, or update the lock.

## Symbol identity

A symbol ID contains package, module path, kind, qualified name, and overload index. The shape is a canonical contract string. Parameter names are excluded from the hash because docs rarely name them. A separate parameter-name hash handles call-form claims.

## Doc anchors

Bindable surfaces:

- inline code
- heading code
- table cells
- fenced code tokens
- signature fences
- explicit references such as `{@link foo}`

Each anchor stores a local context fingerprint. A doc edit changes the fingerprint and withdraws the old claim. A paragraph move does not.

## Three-way diff

The lock is the base. Current code is ours. Current docs are theirs.

A finding requires the doc side to be unchanged and the code contract to break. Additive changes stay silent. The lock keeps the doc's baseline shape, not the latest shape seen.

## Precision

A token that never bound cannot become a finding. Brokenness comes from a tombstone or an explicit reference. Ambiguous names stay unbound. Prose words, paths, URLs, versions, and CLI flags are vetoed before scoring.

## Language layers

TypeScript and Python use dedicated parsers. Rust and Go use a shared lexer with language item parsers. The lexer masks comments and strings while preserving byte offsets, so type text and line numbers stay exact.

Each extractor implements the same versioned `ExtractorPlugin` interface (`src/surface/plugins.ts`): id, API version, extensions, enable predicate, and `extract`. Built-ins are the TypeScript, Python, Rust, rustdoc, Go, and Java plugins. The golden snapshots in `test/golden/` pin one output per language; `conformance/cases/` pins end-to-end rule behavior. Third-party extractors can implement the interface in-process; there is no dynamic plugin loading.

LSIF ingestion converts export monikers into symbols with file, line, name, and qualified name. It sets `indexOnly`, which skips shape comparison because LSIF carries no parameter or return contract.

## Gates

- 95% test coverage.
- 95% changed-line coverage.
- 95% structure gate.

See the repository README for commands.
