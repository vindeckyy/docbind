# Real-drift history

Injected mutations are authored by the maintainer. This check uses real commit history instead: a symbol binding is removed by a real code change while the doc line stays byte-identical. No mutation is authored.

```sh
npm run historical
```

Raw rows: `corpus/historical.json`.

## Method

1. Check out the last commit before each month from December 2025 to November 2026.
2. Write a lock at the older commit.
3. Check out the newer commit with the old lock still in place.
4. For each parent lock entry whose doc line is unchanged:
   - if the symbol ID still exists in the child code, skip;
   - otherwise the doc is stale and detection is expected.
5. A hit is an `L1-broken`, `L2-moved`, or `L4-renamed` finding on that doc line.

## Results

| Repository | Stale-doc removals | Detected | Missed |
|---|---:|---:|---:|
| starlette | 18 | 12 | 6 |
| click | 3 | 2 | 1 |
| chalk | 0 | 0 | 0 |
| express | 0 | 0 | 0 |
| got | 0 | 0 | 0 |
| chi | 0 | 0 | 0 |
| **Total** | **21** | **14** | **7** |

Detection: **14 of 21 real stale-doc removals**, or 66.7%. The 7 misses are published in `corpus/historical.json`. One example: `docs/parameter-types.md:90` references `clamp`, and `click.src.click.types.NumberRangeInfoDict.clamp` disappeared while the line stayed unchanged.

## Limits

- 21 expected removals is a spot check, not a powered benchmark. Per-repository cells are still small.
- Only unchanged doc lines count. A doc updated in the same commit is excluded even if the update was wrong.
- The repositories are selected by the maintainer. The commits are not.
- The commits are external, but the repository selection, month grid, and ground-truth rule are maintainer-defined. This does not replace third-party mutation generation or an external evaluation.
