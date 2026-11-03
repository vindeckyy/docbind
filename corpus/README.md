# Corpus harness

`corpus/repos.json` pins five real repositories at exact commits and ten local fixtures. The harness downloads a source tarball, writes a temporary `docbind.json`, runs `lock`, then measures:

- baseline findings on the unchanged tree
- bind rate for the pinned docs
- doc-edit noise: append a word to an anchored doc line without changing code
- mutation recall: rename one bound symbol in code, leave docs alone, count findings that mention the old name
- value mutations: edit a typed literal such as an enum constructor argument, an annotation argument, or an annotation array element and require an expected rule, for example `L3-reshaped`
- annotation mutations: locate `@Annotation` arguments through the Java token stream, pick the one string literal with the requested value, and replace it; no raw annotation text match
- macro fixture: cross-file `#[macro_export]` repetition macros, with two seeded mutations
- collateral findings: findings for unrelated symbols during each mutation

Run one repository:

```sh
npm run corpus -- --only slugify
```

Refresh cached checkouts:

```sh
npm run corpus -- --refresh
```

Checkouts live in `.corpus/`, which is ignored. `corpus/report.json` is the latest measured snapshot.

Run the network-free fixtures with a strict gate:

```sh
npm run corpus:fixtures
```

CI runs that subset on every push. It fails on baseline findings, doc-edit noise, missed mutations, or collateral findings. External repositories stay manual because they need network access.

Flags:

- `--local-only` skips repositories that need a download.
- `--only a,b` limits the run to named entries.
- `--threshold 0.6` overrides the binding floor for the run.
- `--out path` writes the report somewhere other than `corpus/report.json`.
- `--strict` exits nonzero on any regression metric.
- `--refresh` re-downloads or re-copies every checkout.

`npm run thresholds` sweeps binding floors over the local fixtures and writes `corpus/precision.json`. The results are published in [docs/precision.md](../docs/precision.md).
