# Held-out evaluation

An internal evaluation on three pinned repositories that are not in the corpus. It measures mutation recall and baseline false positives, and publishes the harness so the run can be repeated.

```sh
npm run evaluate
```

Repositories are downloaded to `.eval/` (gitignored) at the commits below.

| Repository | Commit | Language | Docs | Anchors | Bound | Baseline findings | Sampled | Hits | Misses | Collateral |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| chalk/chalk | `7211001` | TypeScript | 3 | 152 | 24 | 0 | 6 | 6 | 0 | 0 |
| pallets/click | `2247b35` | Python | 38 | 3,021 | 671 | 0 | 6 | 6 | 0 | 5 |
| go-chi/chi | `9f8adb1` | Go | 5 | 172 | 62 | 0 | 6 | 6 | 0 | 12 |

Total: **18/18 mutation hits**, **0 baseline findings across 9,849 documentation lines**, and 17 collateral findings.

## Method

1. Discover docs and code, then run `check` with an empty lock to collect bound anchors.
2. Sample the first six bound anchors whose symbol has a readable source file.
3. Write a lock at that state.
4. Rename the symbol's declaration on its source line by appending `Mutated`.
5. Run `check` again. A hit is a new finding that names the symbol or lands on the anchor's doc line.
6. Restore the file. The lock stays, so the next mutation starts from the same baseline.

Collateral counts new findings that do not name the sampled symbol. They are not counted as hits.

Raw rows: `corpus/evaluation.json`.

## Limits

- This is an internal evaluation by the maintainer, not an external reproduction.
- Six samples per repository, chosen as the first readable bindings, not randomly.
- The mutation is a declaration rename, not natural drift.
- Baseline false positives are zero because the checker is silent on unbound annotations; that is not evidence that every bound sentence is correct.
- The repositories are held out from the corpus, but the same maintainer wrote both the tool and the evaluation.

External reproduction on a held-out set is still wanted. A reviewer who runs the harness and gets different numbers should open an issue with the raw report.
