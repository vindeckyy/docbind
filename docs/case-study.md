# Six-month retrospective case study

Two repositories, sampled monthly from May to November 2026. This is a retrospective over git history, not six months of continuous deployment. The point is to publish what the advisory mode actually produces, including findings that are not actionable.

```sh
npm run case-study
```

Raw rows: `corpus/case-study.json`.

## Method

For each adjacent monthly snapshot:

1. Check out the older commit and write a lock.
2. Check out the newer commit with the older lock still in place.
3. Run `check` and count findings by rule. All findings on inferred anchors are notes; none fail a build.
4. Changelogs and migration guides are excluded, matching the default config.

## click (Python)

| Interval | Docs changed | Findings | L1 broken | L3 reshaped |
|---|---:|---:|---:|---:|
| fed9049 → cd9bdd9 | 12 | 79 | 8 | 71 |
| cd9bdd9 → 6ec99f8 | 5 | 76 | 3 | 73 |
| 6ec99f8 → 047adef | 9 | 79 | 5 | 74 |
| 047adef → cb43e05 | 5 | 78 | 4 | 74 |
| cb43e05 → 9f0bcdf | 9 | 79 | 2 | 77 |
| 9f0bcdf → 2247b35 | 0 | 78 | 1 | 77 |
| **Total** | | **469** | **23** | **446** |

All 469 were advisory notes. None failed a build.

## chalk (TypeScript)

Three intervals had distinct commits. Each produced zero findings. The repository mostly references its own types and changed docs alongside code.

## Sampled findings

Six notes from the last click interval were inspected:

| Rule | Location | What changed | Actionable? |
|---|---|---|---|
| L3 | `docs/advanced.md:33` | `Context` class members and iterator type | No. The sentence names the class; it does not assert its shape. |
| L3 | `docs/advanced.md:33` | `Parameter` class members | No. Same. |
| L3 | `docs/advanced.md:80` | `UsageError` members | No. Same. |
| L3 | `docs/advanced.md:81` | `BadParameter` members | No. Same. |
| L3 | `docs/advanced.md:265` | `Command` members | No. Same. |
| L3 | `docs/advanced.md:282` | `nargs` attribute | No. The prose mentions the option name, not its contract. |

Sample result: **0 of 6 actionable**, 6 of 6 advisory noise. These are false positives under the tool's claim that a finding identifies stale documentation.

## What this means

- Inferred contract findings are noisy on class-heavy Python prose. The checker compares the whole class shape even when the doc only names the class.
- The advisory default is doing real work: none of these notes can fail CI, and the human reporter hides notes unless `--all` is passed.
- Teams that want a sound gate should adopt explicit annotations and inline contracts. The `adopt` command writes them; the annotated surface then produces fatal findings only.
- The recall corpus overstates real-world precision because it mutates bound symbols and counts any related finding. This case study is the counterweight.

## Limits

- One maintainer selected the repos, intervals, and sample. There is no external review.
- Six sampled findings is a small audit; the 469 total were not individually classified.
- Retrospective snapshots do not capture how often a team would run the tool, suppress a note, or fix a doc.
- `chalk` had few distinct monthly commits, so three intervals is weaker evidence than click's six.
