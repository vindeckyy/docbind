# Precision evidence

The default confidence floor is `minConfidence = 0.6`. It is configurable per repository. This page publishes the scoring weights behind it and the threshold sweep used to check the floor.

## Scoring weights

Candidates start at zero and accumulate evidence. The final score is clamped to `[0, 1]`.

| Evidence | Weight |
|---|---:|
| Explicit reference, qualified | +0.95 |
| Explicit reference, by name | +0.85 |
| Signature fence, qualified | +0.55 |
| Signature fence, by name | +0.50 |
| Fence import | +0.55 |
| Qualified name | +0.55 |
| Qualified suffix | +0.40 |
| Exported name | +0.35 |
| Unique candidate | +0.15 |
| Call arity matches | +0.20 |
| API doc path | +0.10 |
| Repeated mention | +0.10 |
| Derive context | +0.30 |
| Macro invocation | +0.30 |
| Type alias | +0.20 |
| Constructor call | +0.20 |
| Go package export | +0.40 |
| Shadowed by a local | -0.60 |
| Fragment or truncated fence | -0.20 |
| Base name of two characters or fewer | -0.20 |

A binding also fails when the best score is within `0.05` of the second candidate. Ambiguity is silence, not a guess.

## Threshold sweep

`npm run thresholds` replays the five non-rustdoc local fixtures at each floor. Mutation targets are the union across runs, so recall is measured against a fixed set of 47. Each row reports the baseline findings on the unchanged tree, which are false positives by definition.

| Floor | Bound | Anchors | Bind rate | Baseline findings | Mutation recall | Collateral |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 71 | 72 | 98.6% | 0 | 47/47 | 0 |
| 0.40 | 71 | 72 | 98.6% | 0 | 47/47 | 0 |
| 0.50 | 71 | 72 | 98.6% | 0 | 47/47 | 0 |
| 0.55 | 71 | 72 | 98.6% | 0 | 47/47 | 0 |
| **0.60** | **71** | **72** | **98.6%** | **0** | **47/47** | **0** |
| 0.65 | 70 | 72 | 97.2% | 0 | 46/47 | 0 |
| 0.70 | 70 | 72 | 97.2% | 0 | 46/47 | 0 |
| 0.75 | 70 | 72 | 97.2% | 0 | 46/47 | 0 |
| 0.80 | 64 | 72 | 88.9% | 0 | 40/47 | 0 |
| 0.85 | 62 | 72 | 86.1% | 0 | 40/47 | 0 |
| 0.90 | 62 | 72 | 86.1% | 0 | 40/47 | 0 |

The sweep puts the empirical edge at 0.60. Floors from 0.30 through 0.60 bind the same 71 anchors and detect all 47 mutation targets. At 0.65 one target drops out. On the full corpus, 0.60 raises bound anchors (httpx 417 to 559, anyhow 10 to 14, thiserror 12 to 23) with zero baseline findings. The default now sits at that edge.

The fixtures still do not separate 0.30 from 0.60. A floor below 0.60 adds no bindings on this set, so lowering it further has no measured upside.

Raw rows are stored in [corpus/precision.json](https://github.com/vindeckyy/docbind/blob/main/corpus/precision.json).

## Caveats

- The sweep covers 72 anchors across five local fixtures. It does not cover the five external repositories, whose anchor counts are in the hundreds or thousands.
- Recall here means detecting a seeded rename of a symbol the lock already references. It does not measure whether every doc sentence should have bound in the first place.
- A flat curve means the fixtures do not discriminate thresholds. More adversarial fixtures, especially near-miss names, would separate them.
