# Corpus results

`corpus/repos.json` pins five open-source repositories at exact commits and three local fixtures. The harness downloads each tree, writes a temporary `docbind.json`, runs `lock`, then measures three things:

- baseline findings on the unchanged tree
- bind rate for the pinned docs
- doc-edit noise: append a word to an anchored doc line, with code unchanged
- mutation recall: rename a bound symbol in code, leave docs alone, count findings for that symbol
- collateral findings: findings for unrelated symbols during each mutation

Latest snapshot: [corpus/report.json](https://github.com/vindeckyy/docbind/blob/main/corpus/report.json)

| Repository | Language | Docs | Anchors | Bound | Baseline findings | Mutations | Hits | Misses | Collateral |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| sindresorhus/slugify | TypeScript | 1 | 58 | 28 | 0 | 2 | 2 | 0 | 0 |
| dtolnay/anyhow | Rust | 1 | 79 | 10 | 0 | 3 | 3 | 0 | 0 |
| spf13/viper | Go | 2 | 293 | 66 | 0 | 5 | 5 | 0 | 0 |
| encode/httpx | Python | 23 | 2972 | 379 | 0 | 3 | 3 | 0 | 0 |
| dtolnay/thiserror | Rust | 1 | 162 | 12 | 0 | 2 | 2 | 0 | 0 |
| macro-fixture (local) | Rust | 1 | 11 | 11 | 0 | 9 | 9 | 0 | 0 |
| proc-macro-fixture (local) | Rust | 1 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| go-package-fixture (local) | Go | 1 | 2 | 2 | 0 | 2 | 2 | 0 | 0 |

Editing the first anchored doc line produced zero findings in all seven cases. The three-way diff correctly treated the sentence change as a new claim and re-bound it to unchanged code.

## What the corpus found

The first run produced two false positives on unchanged code.

1. slugify ships matching `index.js` and `index.d.ts` files. Both declarations had the same symbol ID, so `lock` recorded the typed shape and `check` later read the untyped JavaScript shape. Fixed by deduplicating symbols and preferring the declaration with the richer contract.
2. httpx uses Python property getter and setter pairs with the same name. Both members entered the class shape. Fixed by collapsing accessors to one property member.

The same run also found a missed mutation. Removing the typed declaration for `slugifyWithCounter` was treated as compatible because a value with no type is not a value that contradicts a type. The compatibility lattice now treats type erasure as breaking.

## Go package selectors and constants

Go docs use the declared package name, while the extractor's module path follows the file path. Symbols now carry a package-clause alias such as `viper.ReadRemoteConfig` in addition to their file-based alias. Viper bind count rose from 53 to 66 anchors, and mutation coverage grew from 3 to 5. A local Go fixture also exercises a package selector and a constant: `viper.ReadRemoteConfig` and `viper.SupportedExts` both bind, and both mutations are detected.

## Crate macros and generic aliases

anyhow exports `anyhow!`, `bail!`, and other macros through `#[macro_export]`. Exported macro definitions now become symbols with `name!` aliases. Generic type tokens are normalized before lookup, so `anyhow::Result<T>` and `Result<T, anyhow::Error>` resolve to the `Result` type alias. Macro invocations and bare type aliases also earn explicit evidence. anyhow bind count rose from 5 to 10 anchors, and mutation coverage grew from 2 to 3.

## Nested macro capture groups

The macro fixture now defines a `macro_rules!` pattern with an outer group list and two independent inner lists, one for argument names and types and one for return names and types. Each group has a different number of entries. Generated modules keep their own members: `alpha` gets `one`, `two`, and `three`, while `beta` gets `four`, `five`, and `six`. The fixture binds 8 of 8 anchors and detects 5 of 5 mutations, including one symbol from each independent group.

## Optional repetition

The fixture also covers `?` repetition. One generated function receives an optional argument and return type, while another omits both. The matcher consumes one occurrence when the segment matches and zero when it does not. Both generated symbols bind, and both are mutated and detected.

## Non-exported sibling macros

The fixture also defines a plain `macro_rules!` in `src/macros.rs` without `#[macro_export]` and invokes it from `src/lib.rs` under `#[macro_use]`. The first extraction pass now collects every definition for the package, so sibling-module macros resolve crate-wide. The fixture binds 9 of 9 anchors and detects 7 of 7 mutations.

## Bind-rate improvement

The first anyhow run bound 0 of 90 anchors. Rust docs write `anyhow::Result`, while aliases only exposed module paths. Adding crate-name aliases and normalizing `::` against `.` raised anyhow to four bound anchors and exposed two mutations, both detected.

The first viper run bound 0 of 382 anchors. Go docs write `viper.SetConfigName`, and the fence parser was splitting it into `viper` and `SetConfigName`. Capturing qualified chains raised viper to 53 bound anchors and exposed three mutations, all detected.

The first httpx run bound 34 of 2541 anchors. Class-qualified calls such as `Response.json()` were vetoed as file paths, and package-qualified names such as `httpx.Client` had no aliases. Exempting class-qualified calls from the path veto and adding package and class aliases raised httpx to 65 bound anchors.

Python fences then gained local type inference. Source return annotations feed a type map, so `response = client.get(...)` resolves through `Client.get -> Response` and `response.json()` becomes `Response.json`. Annotations, `with ... as` blocks, REPL prompts, and `pycon` fences are handled. Dotted chains stay whole instead of splitting into unrelated identifiers. This raised httpx to 379 bound anchors on 2972 anchors with zero baseline findings.

## Limits

- thiserror is a real proc-macro crate. Its derive name is recognized through `#[proc_macro_derive]`, not expanded.
- macro-fixture and proc-macro-fixture are local. They exercise generated items, not external project coverage.
- proc-macro-fixture enables the opt-in rustdoc JSON extractor. It requires `cargo +nightly` and executes a proc macro during extraction.
- Standard derives such as `Clone`, `Default`, `Debug`, `PartialEq`, `PartialOrd`, `Ord`, and `Hash` are synthesized for public Rust types.
- `#[proc_macro_derive(Name)]` is recognized as a derive name. The macro body is not expanded.
- `macro_rules!` covers `ident`, `vis`, `tt`, and `ty` fragments, literal matcher tokens, comma and semicolon repetition, `?`, nested repetition with independent capture groups, separate top-level repetition lists, cross-file `#[macro_export]` macros, and non-exported sibling-module macros. It does not expand general proc-macro output.
- Non-exported macros are collected crate-wide per package. If two modules define the same macro name, the last definition wins.
- anyhow binds ten anchors after crate macros and generic type aliases were added. Most of its README still uses standard-library types and prose that do not map to crate symbols.
- httpx inference is assignment-local and return-type based. It does not perform control-flow analysis, and unresolved instance variables still stay unbound.
- Mutation recall only covers symbols that already bound. Bind rate is reported separately.
- The corpus uses five external repositories and three local fixtures. It is evidence, not a benchmark.

Run the harness from the repository root:

```sh
npm run corpus
npm run corpus -- --only slugify --refresh
```
