# Corpus harness

`corpus/repos.json` pins five real repositories at exact commits and ten local fixtures. The harness downloads a source tarball, writes a temporary `docbind.json`, runs `lock`, then measures:

- baseline findings on the unchanged tree
- bind rate for the pinned docs
- doc-edit noise: append a word to an anchored doc line without changing code
- mutation recall: rename one bound symbol in code, leave docs alone, count findings that mention the old name
- annotation mutations: locate `@Annotation` arguments through the Java token stream, then pick the string literal by value or by array index and replace it; no raw annotation text match
- enum mutations: locate an enum constant through the Java token stream, bound its constructor arguments, pick the unique string literal with the requested value, and replace it
- default mutations: locate an annotation method through the Java token stream, find its `default` clause, and replace the unique matching string or number
- constant mutations: locate a static field initializer through the Java token stream and replace the unique matching string, proving that resolved defaults track the constant, including constants in another file
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
