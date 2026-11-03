# Changelog

All notable changes are recorded here. The format follows Keep a Changelog and the project uses semantic versioning.

## [0.1.32] - 2026-11-03

### Added

- Go fence inference keeps declared types from qualified package-variable selectors such as `var Qualified = other.Selected`.
- Local Go fixture covers a qualified selected variable with a distinct mutation.

### Improved

- Go fixture grew from 31 to 33 bound anchors and from 22 to 23 detected mutations.
- Corpus now detects 52 of 52 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.31] - 2026-11-03

### Added

- Go fence inference follows struct field chains, so `cfg := Config{Viper: New()}` resolves `cfg.Viper.Field()` through `Config.Viper -> Viper.Field`.
- Local Go fixture covers a struct-field method with a distinct mutation.

### Improved

- Go fixture grew from 27 to 31 bound anchors and from 21 to 22 detected mutations.
- Corpus now detects 51 of 51 seeded mutations with zero collateral findings.
- The new struct-field selector binds to the target method instead of a local struct path.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.30] - 2026-11-03

### Added

- Go fence inference types multi-return helper calls such as `v, err := loadViper()` from the first return type.
- Tuple return types such as `(*Viper, error)` are normalized to `Viper`.
- Local Go fixture covers a multi-return helper with a distinct mutation.

### Improved

- Go fixture grew from 25 to 27 bound anchors and from 19 to 21 detected mutations.
- Corpus now detects 50 of 50 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.29] - 2026-11-03

### Added

- Go fence inference reads return types from same-fence helper functions.
- `v := loadViper()` types `v` when `func loadViper() *Viper` appears in the fence.
- Local Go fixture covers a helper-return method with a distinct mutation.

### Improved

- Go fixture grew from 22 to 25 bound anchors and from 18 to 19 detected mutations.
- Corpus now detects 48 of 48 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.03% to 95.05%.

### Limits

- Go fence inference does not type externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.28] - 2026-11-03

### Added

- Go fence inference types package-level variables from constructor calls and composite literals.
- `var Default = New()` lets `v := viper.Default` resolve `v.Get()` to `Viper.Get`.
- Local Go fixture covers a package variable with a distinct mutation.

### Improved

- Go fixture grew from 20 to 22 bound anchors and from 16 to 18 detected mutations.
- Corpus now detects 47 of 47 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.27] - 2026-11-03

### Added

- Go fence function parameters infer their types from the signature, including grouped parameters such as `v, w *Viper`.
- Local Go fixture covers a typed-parameter method with a distinct mutation.

### Improved

- Go fixture grew from 18 to 20 bound anchors and from 15 to 16 detected mutations.
- Corpus now detects 45 of 45 seeded mutations with zero collateral findings.
- Viper anchors fell from 196 to 194 while keeping 94 bound symbols.

### Limits

- Go fence inference does not type externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.26] - 2026-11-03

### Added

- Go fence alias copies such as `w := v` inherit the current local type, so `w.Copied()` resolves through `Viper.Copied`.
- Local Go fixture covers an alias-copied method with a distinct mutation.

### Improved

- Go fixture grew from 17 to 18 bound anchors and from 14 to 15 detected mutations.
- Corpus now detects 44 of 44 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type function parameters or externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.25] - 2026-11-03

### Added

- Go fence locals infer types from annotated declarations such as `var v *Viper` and from reassignments.
- Unknown reassignments clear the inferred type, preventing stale method binds.
- Go keyword tokens such as `var` are filtered from fence anchors.

### Improved

- Go fixture grew from 12 to 17 bound anchors and from 12 to 14 detected mutations.
- Corpus now detects 43 of 43 seeded mutations with zero collateral findings.
- Viper anchors fell from 267 to 196 through keyword and local-attribute filtering, while keeping 94 bound symbols.
- Branch coverage rose from 95.10% to 95.12%.

### Limits

- Go fence inference is assignment-local. Aliased or externally supplied locals are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.24] - 2026-11-03

### Added

- Go fence locals infer types from constructor calls and composite literals, so `v := viper.New()` resolves `v.Get()` to `Viper.Get`.
- Local Go fixture covers constructor-typed local method calls.

### Improved

- Go fixture grew from 10 to 12 bound anchors and from 10 to 12 detected mutations.
- Corpus now detects 41 of 41 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.06% to 95.10%.
- Untyped Go local attribute tokens are skipped, reducing viper's anchor count from 293 to 267 while keeping 94 bound symbols.

### Limits

- Go fence inference is assignment-local. Reassigned, aliased, or externally supplied locals are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.23] - 2026-11-03

### Added

- Go re-export cycles terminate with bounded passes and keep local symbols instead of creating false cross-package aliases.
- Local two-package cycle fixture covers value and type cycles.

### Improved

- Cycle fixture binds 2 of 2 anchors and detects 2 of 2 mutations.
- Corpus now detects 39 of 39 seeded mutations with zero collateral findings.

### Limits

- Go arbitrary arithmetic and composite expressions are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.22] - 2026-11-03

### Added

- Go instance-method wrappers infer the receiver parameter type and attach the wrapper selector to the target method.
- Local Go fixture covers `viper.WrapInstance` through `func WrapInstance(c *client.Client, value int) { return c.Instance(value) }`.

### Improved

- Go fixture grew from 9 to 10 bound anchors and from 9 to 10 detected mutations.
- Corpus now detects 37 of 37 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.05% to 95.06%.

### Limits

- Go arbitrary arithmetic, composite expressions, and re-export cycles are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.21] - 2026-11-03

### Added

- Go method-valued selectors such as `var MethodValue = client.Client.Computed` attach the re-export alias to the target method.
- Direct method-call wrappers such as `return client.Client.Wrapped(...)` attach the wrapper selector to the target method.
- Local Go fixture covers method-valued and computed aliases with separate mutation coverage.

### Improved

- Go fixture grew from 7 to 9 bound anchors and from 7 to 9 detected mutations.
- Corpus now detects 36 of 36 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.02% to 95.05%.

### Limits

- Go arbitrary arithmetic and composite expressions, instance-method wrappers, and re-export cycles are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.20] - 2026-11-03

### Added

- Go re-export aliases propagate through multiple package hops for type aliases, values, constants, and wrapper functions.
- Local Go fixture covers a chained `viper.AppClient.Special()` selector.

### Improved

- Go fixture grew from 6 to 7 bound anchors and from 6 to 7 detected mutations.
- Corpus now detects 34 of 34 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.01% to 95.02%.

### Limits

- Go computed re-exports, method-valued wrappers, and re-export cycles are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.19] - 2026-11-03

### Added

- Go wrapper functions that only return a call to another package attach the wrapper selector to the target function.
- Local Go fixture covers `viper.Wrap(1)` through `func Wrap(...) { return client.Target(...) }`.

### Improved

- Go fixture grew from 5 to 6 bound anchors and from 5 to 6 detected mutations.
- Corpus now detects 33 of 33 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.00% to 95.01%.

### Limits

- Go multi-step re-export chains are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.18] - 2026-11-03

### Added

- Go variable and constant re-exports follow simple selectors such as `var ErrX = client.ErrX` and `const Limit = client.Limit`.
- Re-export aliases attach to the target symbol and the duplicate local symbol is removed.

### Improved

- Go fixture grew from 3 to 5 bound anchors and from 3 to 5 detected mutations.
- Corpus now detects 32 of 32 seeded mutations with zero collateral findings.

### Limits

- Go wrapper-function and multi-step re-export chains are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.17] - 2026-11-03

### Added

- Go type aliases resolve cross-package re-exports, exposing target methods under the re-exporting package selector.
- Local Go fixture covers `viper.Client.Perform()` through `type Client = client.Client`.

### Fixed

- Go methods attach to types in their own package directory, so same-named types in different packages no longer collide.

### Improved

- Go fixture grew from 2 to 3 bound anchors and from 2 to 3 detected mutations.
- Corpus now detects 30 of 30 seeded mutations with zero collateral findings.

### Limits

- Go re-exports are followed through type aliases. Variable, constant, and wrapper-function re-exports are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.16] - 2026-11-03

### Added

- Unique bare exported Go identifiers receive package-export evidence, resolving names such as `SetDefault`, `GetInt`, `Unmarshal`, and `FlagValue` even when a method shares the name.

### Fixed

- Corpus harness refreshes lock entries on every run, so stale bindings cannot inflate counts.

### Improved

- viper corpus bind rate rose from 66 to 94 anchors. Mutation coverage rose from 5 to 8.
- Corpus now detects 29 of 29 seeded mutations with zero collateral findings.

### Limits

- Go package aliases do not model re-exports through a separate package.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.15] - 2026-11-03

### Added

- Go symbols carry aliases from the declared package clause, not only the file-based module path.
- Local Go corpus fixture covers a package selector and a constant.

### Improved

- viper corpus bind rate rose from 53 to 66 anchors. Mutation coverage rose from 3 to 5.
- Corpus now detects 26 of 26 seeded mutations with zero collateral findings.

### Limits

- Go package aliases do not model re-exports through a separate package.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.14] - 2026-11-03

### Added

- Exported Rust `macro_rules!` definitions are emitted as symbols with `name!` aliases.
- Generic type tokens such as `anyhow::Result<T>` normalize to their base type for lookup.
- Macro invocations and bare type aliases earn dedicated binding evidence.

### Improved

- anyhow corpus bind rate rose from 5 to 10 anchors. Mutation coverage rose from 2 to 3.
- Corpus now detects 22 of 22 seeded mutations with zero collateral findings.

### Limits

- Crate-wide macro collection is name-based. Same-name non-exported macros in different modules let the last definition win.
- General proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.13] - 2026-11-03

### Added

- Rust `macro_rules!` supports optional `?` repetition in matchers and transcribers, including absent captures.
- Macro corpus fixture covers optional argument and return captures.

### Improved

- Macro fixture bind rate rose from 9 to 11 anchors. Seeded mutations rose from 7 to 9, all detected.
- Corpus now detects 21 of 21 seeded mutations with zero collateral findings.

### Limits

- Crate-wide macro collection is name-based. Same-name non-exported macros in different modules let the last definition win.
- General proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.12] - 2026-11-03

### Added

- Non-exported `macro_rules!` definitions are collected per package and resolve across sibling modules.
- Macro corpus fixture now invokes a plain sibling-module macro under `#[macro_use]`.

### Improved

- Macro fixture bind rate rose from 8 to 9 anchors. Seeded mutations rose from 5 to 7, all detected.
- Corpus now detects 19 of 19 seeded mutations with zero collateral findings.

### Limits

- Crate-wide macro collection is name-based. Same-name non-exported macros in different modules let the last definition win.
- `?` repetition and general proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.11] - 2026-11-03

### Added

- Nested Rust `macro_rules!` repetition preserves independent capture trees, so each outer group keeps its own inner lists.
- Separate top-level repetition lists in one matcher are bounded by the following literal.
- Shorter module aliases such as `alpha.two` for generated nested-module functions.
- Macro corpus fixture now covers grouped modules with different inner list lengths.

### Improved

- Macro fixture bind rate rose from 5 to 8 anchors. Seeded mutations rose from 3 to 5, all detected.
- Corpus now detects 17 of 17 seeded mutations with zero collateral findings.

### Limits

- `?` repetition, non-exported cross-file macros, and general proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.10] - 2026-11-03

### Added

- Python local type inference in fenced examples. Constructor assignments, annotations, `with ... as` blocks, and source return annotations resolve instance calls such as `response.json()`.
- `pycon` fence support for Python REPL examples.
- Python dotted fence chains stay whole, so `httpx.get` and `Client.get` remain qualified.

### Fixed

- Corpus mutation attribution now relates class-member findings to the mutated class.

### Improved

- httpx corpus bind rate rose from 65 to 379 anchors with zero baseline and zero doc-edit findings.

### Limits

- Python inference is assignment-local and return-type based. It does not perform control-flow analysis.
- Nested repetition with independent capture trees and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

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
[0.1.10]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.10
[0.1.11]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.11
[0.1.12]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.12
[0.1.13]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.13
[0.1.14]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.14
[0.1.15]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.15
[0.1.16]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.16
[0.1.17]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.17
[0.1.18]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.18
[0.1.19]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.19
[0.1.20]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.20
[0.1.21]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.21
[0.1.22]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.22
[0.1.23]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.23
[0.1.24]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.24
[0.1.25]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.25
[0.1.26]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.26
[0.1.27]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.27
[0.1.28]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.28
[0.1.29]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.29
[0.1.30]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.30
[0.1.31]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.31
[0.1.32]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.32
