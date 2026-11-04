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

`npm run thresholds` replays the eight non-rustdoc local fixtures at each floor. Each floor locks its own symbols, so the mutation set changes with the floor. Recall is measured against the targets that floor actually locked. Baseline findings on the unchanged tree are false positives by definition.

| Floor | Bound | Anchors | Bind rate | Baseline findings | Mutation recall | Collateral |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 110 | 111 | 99.1% | 0 | 89/89 | 0 |
| 0.40 | 110 | 111 | 99.1% | 0 | 89/89 | 0 |
| 0.50 | 110 | 111 | 99.1% | 0 | 89/89 | 0 |
| 0.55 | 110 | 111 | 99.1% | 0 | 89/89 | 0 |
| **0.60** | **110** | **111** | **99.1%** | **0** | **89/89** | **0** |
| 0.65 | 108 | 111 | 97.3% | 0 | 87/87 | 0 |
| 0.70 | 108 | 111 | 97.3% | 0 | 87/87 | 0 |
| 0.75 | 108 | 111 | 97.3% | 0 | 87/87 | 0 |
| 0.80 | 102 | 111 | 91.9% | 0 | 81/81 | 0 |
| 0.85 | 100 | 111 | 90.1% | 0 | 81/81 | 0 |
| 0.90 | 100 | 111 | 90.1% | 0 | 81/81 | 0 |

Recall is 100% at every local floor. The floors separate on coverage: 0.65 drops one bound anchor and its mutation target; 0.80 drops seven.

## Full-corpus sweep

The same sweep over all twelve corpus cases gives a sharper coverage edge. Floors of 0.40 and 0.50 bind 17 more anchors than 0.60 with zero baseline findings. Those 17 have exactly one form of evidence: a unique exported name, score `0.35 + 0.15 = 0.50`. At 0.70 the bound count drops by 158 anchors. Recall stays 100% at every floor because the harness mutates only symbols that floor locked.

| Floor | Bound | Anchors | Bind rate | Baseline findings | Mutation recall | Collateral |
|---:|---:|---:|---:|---:|---:|---:|
| 0.40 | 849 | 3399 | 25.0% | 0 | 109/109 | 0 |
| 0.50 | 849 | 3399 | 25.0% | 0 | 109/109 | 0 |
| 0.55 | 833 | 3399 | 24.5% | 0 | 109/109 | 0 |
| **0.60** | **832** | **3399** | **24.5%** | 0 | **109/109** | 0 |
| 0.70 | 673 | 3399 | 19.8% | 0 | 107/107 | 0 |
| 0.80 | 632 | 3399 | 18.6% | 0 | 100/100 | 0 |

The default stays at 0.60. Lowering to 0.50 would add 17 anchors, but each is a bare name with no import, qualification, signature, or API-doc context. The precision model treats name-only matches in prose as noise, and the test suite pins that rule. The 17 extra anchors are not evidence that the floor should move; they are the class of binding the floor exists to reject.

Raising the floor costs tracked anchors, not detections, on this corpus. 0.60 is the lowest floor that keeps the name-only band silent while retaining the full lock.

The union across floors is 69 targets; no floor selects all 69, and every selected target is detected. Per-floor selection size is the honest denominator.

Raw rows are in `corpus/precision.json` for the local sweep and `corpus/precision-external.json` for the full sweep.

## Caveats

- The local sweep covers 111 anchors across eight fixtures. The full sweep covers all 3360 anchors but only five floors.
- Recall here means detecting a seeded rename of a symbol that floor locked. It says nothing about symbols the floor did not bind.
- The full sweep samples five floors. A finer scan between 0.50 and 0.70 could locate a tighter edge.
