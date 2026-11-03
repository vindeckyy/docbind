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

The local fixtures do not separate floors from 0.30 through 0.60. The first local loss appears at 0.65.

## Full-corpus sweep

The same sweep over all twelve corpus cases gives a sharper edge. Floors of 0.40 and 0.50 bind 17 more anchors than 0.60 with zero baseline findings. Those 17 have exactly one form of evidence: a unique exported name, score `0.35 + 0.15 = 0.50`. At 0.70 the bound count drops by 158 anchors and recall falls from 67 to 66 of the 69 union targets collected across floors.

| Floor | Bound | Anchors | Bind rate | Baseline findings | Mutation recall | Collateral |
|---:|---:|---:|---:|---:|---:|---:|
| 0.40 | 810 | 3360 | 24.1% | 0 | 67/69 | 0 |
| 0.50 | 810 | 3360 | 24.1% | 0 | 67/69 | 0 |
| 0.55 | 794 | 3360 | 23.6% | 0 | 67/69 | 0 |
| **0.60** | **793** | **3360** | **23.6%** | **0** | **67/69** | **0** |
| 0.70 | 635 | 3360 | 18.9% | 0 | 66/69 | 0 |
| 0.80 | 594 | 3360 | 17.7% | 0 | 59/69 | 0 |

The default stays at 0.60. Lowering to 0.50 would add 17 anchors, but each is a bare name with no import, qualification, signature, or API-doc context. The precision model treats name-only matches in prose as noise, and the test suite pins that rule. The 17 extra anchors are not evidence that the floor should move; they are the class of binding the floor exists to reject.

At 0.70 recall drops, so 0.60 is the lowest floor that keeps the name-only band silent while retaining full recall.

Two union targets are never detected at any floor. Both are mutation selections that only entered the lock at a single threshold, not missed references in the current lock.

Raw rows are in `corpus/precision.json` for the local sweep and `corpus/precision-external.json` for the full sweep.

## Caveats

- The local sweep covers 72 anchors across five fixtures. The full sweep covers all 3360 anchors but only five floors.
- Recall here means detecting a seeded rename of a symbol the lock already references. It does not measure whether every doc sentence should have bound in the first place.
- The full sweep samples five floors. A finer scan between 0.50 and 0.70 could locate a tighter edge.
