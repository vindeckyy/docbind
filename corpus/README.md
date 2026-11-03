# Corpus harness

`corpus/repos.json` pins real repositories at exact commits and one local macro fixture. The harness downloads a source tarball, writes a temporary `docbind.json`, runs `lock`, then measures:

- baseline findings on the unchanged tree
- bind rate for the pinned docs
- doc-edit noise: append a word to an anchored doc line without changing code
- mutation recall: rename one bound symbol in code, leave docs alone, count findings that mention the old name
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

The corpus is not part of CI. It needs network access and parses full external repositories.
