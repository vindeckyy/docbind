# Corpus results

`corpus/repos.json` pins five open-source repositories at exact commits and one local macro fixture. The harness downloads each tree, writes a temporary `docbind.json`, runs `lock`, then measures three things:

- baseline findings on the unchanged tree
- bind rate for the pinned docs
- doc-edit noise: append a word to an anchored doc line, with code unchanged
- mutation recall: rename a bound symbol in code, leave docs alone, count findings for that symbol
- collateral findings: findings for unrelated symbols during each mutation

Latest snapshot: [corpus/report.json](https://github.com/vindeckyy/docbind/blob/main/corpus/report.json)

| Repository | Language | Docs | Anchors | Bound | Baseline findings | Mutations | Hits | Misses | Collateral |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| sindresorhus/slugify | TypeScript | 1 | 58 | 28 | 0 | 2 | 2 | 0 | 0 |
| dtolnay/anyhow | Rust | 1 | 79 | 4 | 0 | 2 | 2 | 0 | 0 |
| spf13/viper | Go | 2 | 293 | 53 | 0 | 3 | 3 | 0 | 0 |
| encode/httpx | Python | 23 | 2541 | 34 | 0 | 3 | 3 | 0 | 0 |
| dtolnay/thiserror | Rust | 1 | 162 | 21 | 0 | 2 | 2 | 0 | 0 |
| macro-fixture (local) | Rust | 1 | 4 | 4 | 0 | 2 | 2 | 0 | 0 |

Editing the first anchored doc line produced zero findings in all six cases. The three-way diff correctly treated the sentence change as a new claim and re-bound it to unchanged code.

## What the corpus found

The first run produced two false positives on unchanged code.

1. slugify ships matching `index.js` and `index.d.ts` files. Both declarations had the same symbol ID, so `lock` recorded the typed shape and `check` later read the untyped JavaScript shape. Fixed by deduplicating symbols and preferring the declaration with the richer contract.
2. httpx uses Python property getter and setter pairs with the same name. Both members entered the class shape. Fixed by collapsing accessors to one property member.

The same run also found a missed mutation. Removing the typed declaration for `slugifyWithCounter` was treated as compatible because a value with no type is not a value that contradicts a type. The compatibility lattice now treats type erasure as breaking.

## Bind-rate improvement

The first anyhow run bound 0 of 90 anchors. Rust docs write `anyhow::Result`, while aliases only exposed module paths. Adding crate-name aliases and normalizing `::` against `.` raised anyhow to four bound anchors and exposed two mutations, both detected.

The first viper run bound 0 of 382 anchors. Go docs write `viper.SetConfigName`, and the fence parser was splitting it into `viper` and `SetConfigName`. Capturing qualified chains raised viper to 53 bound anchors and exposed three mutations, all detected.

## Limits

- thiserror is a real proc-macro crate. Its derive name is recognized through `#[proc_macro_derive]`, not expanded.
- macro-fixture is local. It exists to exercise generated items, not to represent an external project.
- Standard derives such as `Clone`, `Default`, `Debug`, `PartialEq`, `PartialOrd`, `Ord`, and `Hash` are synthesized for public Rust types.
- `#[proc_macro_derive(Name)]` is recognized as a derive name. The macro body is not expanded.
- `macro_rules!` covers `ident`, `vis`, `tt`, and `ty` fragments, literal matcher tokens, comma and semicolon repetition, and cross-file `#[macro_export]` macros. It does not handle nested repetition, non-exported cross-file macros, or general proc-macro output.
- anyhow binds four anchors after crate-name aliases were added. Most of its README still uses macros and types that do not expose a unique exported name. Their docs use macros and ambiguous package and method names, so the confidence floor stays silent.
- Mutation recall only covers symbols that already bound. Bind rate is reported separately.
- The corpus uses four repositories. It is evidence, not a benchmark.

Run the harness from the repository root:

```sh
npm run corpus
npm run corpus -- --only slugify --refresh
```
