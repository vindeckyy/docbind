# Corpus results

`corpus/repos.json` pins four repositories at exact commits. The harness downloads each tree, writes a temporary `docbind.json`, runs `lock`, then measures three things:

- baseline findings on the unchanged tree
- bind rate for the pinned docs
- mutation recall: rename a bound symbol in code, leave docs alone, count findings for that symbol
- collateral findings: findings for unrelated symbols during each mutation

Latest snapshot: [corpus/report.json](https://github.com/vindeckyy/docbind/blob/main/corpus/report.json)

| Repository | Language | Docs | Anchors | Bound | Baseline findings | Mutations | Hits | Misses | Collateral |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| sindresorhus/slugify | TypeScript | 1 | 58 | 28 | 0 | 2 | 2 | 0 | 0 |
| dtolnay/anyhow | Rust | 1 | 79 | 0 | 0 | 0 | 0 | 0 | 0 |
| spf13/viper | Go | 2 | 293 | 53 | 0 | 3 | 3 | 0 | 0 |
| encode/httpx | Python | 23 | 2541 | 34 | 0 | 3 | 3 | 0 | 0 |

## What the corpus found

The first run produced two false positives on unchanged code.

1. slugify ships matching `index.js` and `index.d.ts` files. Both declarations had the same symbol ID, so `lock` recorded the typed shape and `check` later read the untyped JavaScript shape. Fixed by deduplicating symbols and preferring the declaration with the richer contract.
2. httpx uses Python property getter and setter pairs with the same name. Both members entered the class shape. Fixed by collapsing accessors to one property member.

The same run also found a missed mutation. Removing the typed declaration for `slugifyWithCounter` was treated as compatible because a value with no type is not a value that contradicts a type. The compatibility lattice now treats type erasure as breaking.

## Bind-rate improvement

The first viper run bound 0 of 382 anchors. Go docs write `viper.SetConfigName`, and the fence parser was splitting it into `viper` and `SetConfigName`. Capturing qualified chains raised viper to 53 bound anchors and exposed three mutations, all detected.

## Limits

- anyhow has no bound anchors in this snapshot. Its README is built around macros and types without a unique exported name. Their docs use macros and ambiguous package and method names, so the confidence floor stays silent.
- Mutation recall only covers symbols that already bound. Bind rate is reported separately.
- The corpus uses four repositories. It is evidence, not a benchmark.

Run the harness from the repository root:

```sh
npm run corpus
npm run corpus -- --only slugify --refresh
```
