# Changelog

All notable changes are recorded here. The format follows Keep a Changelog and the project uses semantic versioning.

## [0.1.9] - 2026-11-03

### Added

- Python package-qualified aliases such as `httpx.Client` and `httpx.Response.json`.
- Python class-qualified method and attribute binding for names such as `Response.json()` and `Response.status_code`.

### Fixed

- Class-qualified references ending in a file-like suffix, such as `Response.json()`, are no longer vetoed as file paths.
- httpx corpus bind rate rose from 34 to 65 anchors with zero baseline findings.

### Limits

- Instance-qualified Python references such as `response.json()` still need local type inference.
- Nested repetition with independent capture trees and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.8] - 2026-11-03

### Added

- Nested Rust `macro_rules!` repetition for patterns that share a metavariable across levels.
- Macro corpus fixture now includes a cross-file nested repetition invocation.
- Nested-generated symbol mutation is detected.

### Limits

- Nested repetition with independent capture trees is still not expanded.
- The unscoped npm package remains unavailable.

## [0.1.7] - 2026-11-03

### Added

- Rustdoc shape fidelity for structs, enums, traits, fields, variants, type aliases, and constants.
- Proc-macro fixture now generates both a function and a struct field that the rustdoc extractor discovers.

### Limits

- Rustdoc type rendering remains coarse for complex qualified, function-pointer, and associated types.
- Nested `macro_rules!` repetition and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.6] - 2026-11-03

### Added

- Opt-in rustdoc JSON extractor for proc-macro-generated public functions, impl methods, trait methods, and macro items.
- Local proc-macro workspace fixture that exercises the rustdoc extractor.
- Real thiserror corpus case now runs with rustdoc extraction enabled.

### Security

- Rustdoc extraction runs `cargo +nightly rustdoc`, which executes build scripts and proc macros. It is off by default and only enabled explicitly.

### Limits

- Nested `macro_rules!` repetition and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.5] - 2026-11-03

### Added

- Standard Rust derive synthesis for `Clone`, `Default`, `Debug`, `PartialEq`, `PartialOrd`, `Ord`, and `Hash`.
- `#[proc_macro_derive(Name)]` recognition in Rust extractors.
- Real thiserror proc-macro corpus case.
- Derive attributes in fenced docs now provide structural binding evidence.

### Limits

- General proc-macro output, derive bodies, and nested repetition are not expanded.
- The unscoped npm package remains unavailable.

## [0.1.4] - 2026-11-03

### Added

- Rust `macro_rules!` repetition patterns with comma and semicolon separators, `*` and `+`.
- Cross-file `#[macro_export]` macro usage through `crate::name!` paths.
- Macro fixture now exercises cross-file repetition and two generated functions.

### Limits

- Nested repetition, non-exported cross-file macros, proc macros, and derive output are not expanded.

## [0.1.3] - 2026-11-03

### Added

- Narrow Rust `macro_rules!` expansion for same-file item generators using `ident`, `vis`, `tt`, and `ty` fragments.
- Local macro-heavy corpus fixture with generated public functions. Both mutations detected.

### Limits

- Macro expansion does not cover repetition, cross-file macro imports, proc macros, or derive output.

## [0.1.2] - 2026-11-03

### Added

- Pinned open-source corpus harness in `corpus/`. It measures baseline findings, doc-edit noise, bind rate, mutation recall, and collateral findings.
- Corpus report and methodology page.

### Fixed

- Duplicate JS and `.d.ts` declarations no longer produce false L3 findings.
- Python property getter and setter pairs no longer produce duplicate class members.
- Removing a type annotation from a documented symbol is now a breaking change instead of a silent pass.

### Improved

- Rust and Go fenced code keeps qualified chains such as `viper.SetConfigName` and `User::new` instead of splitting them into unrelated identifiers. The viper corpus bind rate rose from 0 to 53 anchors.
- Rust crate-name aliases such as `anyhow::Result`, plus `::` and `.` path normalization, raised the anyhow corpus bind rate from 0 to 4 anchors.

## [0.1.1] - 2026-11-03

### Added

- Rust and Go signature fences. Fenced declarations now compare against the real symbol shape.
- Signature pairing for Rust methods and Go receiver methods.
- Go type blocks with struct and interface declarations.
- Go interface embedding in shape comparison.
- Go receiver mutability in method shapes.
- TypeScript namespace re-exports such as `export * as api from "./mod"`.
- Rust cross-file and grouped `pub use` aliases.
- Go methods declared in a different file from their receiver type.
- Rust impl methods declared in a different file from their type.

### Changed

- Package name is now `@vindeckyy/docbind`. The unscoped `docbind` npm name belongs to an unrelated package.
- Source install and GitHub Action instructions no longer call the unscoped npm package.

## [0.1.0] - 2026-11-03

### Added

- TypeScript and JavaScript extraction through the TypeScript compiler API.
- Python extraction through a bundled `ast` worker.
- Rust extraction through a shared lexer and item parser.
- Go extraction through a shared lexer and declaration parser. Opt-in.
- Markdown anchors for inline code, headings, tables, fenced code, signature fences, and explicit references.
- Binding lock, three-way diff, tombstones, and rename and move inference.
- Contract shapes for parameters, return types, members, enums, receivers, async, unsafe, and deprecation.
- Compatibility lattice that keeps additive changes silent.
- CLI commands: `init`, `check`, `lock`, `fix`, `explain`, `stats`.
- SARIF, GitHub annotations, JSON output, and severity policy.
- Conservative fix engine for renames and moved paths.
- Changed-line coverage gate, structure gate, and 95% test coverage thresholds.
- MkDocs documentation site and GitHub Pages workflow.

### Security

- Extraction parses source. It does not build or execute project code.

[0.1.0]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.0
[0.1.1]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.1
[0.1.2]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.2
[0.1.3]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.3
[0.1.4]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.4
[0.1.5]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.5
[0.1.6]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.6
[0.1.7]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.7
[0.1.8]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.8
[0.1.9]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.9
