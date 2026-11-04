# Recall and false-positive evidence

`npm run recall` aggregates injected mutation classes from `corpus/report.json` and prints recall per language and class. Mutation hits are measured with the full checker; collateral findings are reported separately by the corpus harness.

## Mutation matrix

Each cell is a single curated mutation in a local fixture. External repositories still carry rename and value mutations only.

| Language | Signature | Return type | Visibility | Move | Kind | Total |
|---|---:|---:|---:|---:|---:|---:|
| Java | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 5/5 |
| Python | 1/1 | 1/1 | 1/1 | 1/1 | — | 4/4 |
| Go | 1/1 | 1/1 | 1/1 | — | 1/1 | 4/4 |
| **All** | **3/3** | **3/3** | **3/3** | **2/2** | **2/2** | **13/13** |

False positives on unmodified checkouts: **0 baseline findings across 5,631 doc lines**, or **0.000 per 1k lines**. Doc-edit noise and mutation collateral are both 0.

## What the mutations do

- Signature: add a required parameter to a bound function.
- Return: change the return type or annotation.
- Visibility: remove export or make a declaration non-public.
- Move: rename or relocate the owning type so the qualified path changes.
- Kind: change class/struct/enum to another kind.

The mutations are token-located text edits against known source, not random fuzzing. A miss means the checker stayed silent on a seeded change.

## Limits

- One mutation per cell. This is a smoke matrix, not a statistical benchmark.
- Only Java, Python, and Go have class mutations. TypeScript, Rust, and the external repositories contribute rename/value/default mutations only.
- The fixtures and mutations are maintainer-authored. There is no independent evaluation.
- Recall is measured only for symbols that already bound. Unbound anchors are a separate false-negative surface; see [Corpus](corpus.md) and [Scope and limits](scope.md).
- A 13/13 result says the detector handles these seeded shapes. It does not estimate recall on arbitrary repositories.

## Reproduce

```sh
npm run corpus
npm run recall
```

The raw rows are in `corpus/report.json`; `mutationClass` identifies each class mutation.
