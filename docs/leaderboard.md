# Evidence log

This log records smoke-matrix and held-out numbers for docbind versions. It is not a ranking: the class matrix has one mutation per cell and no third-party entrants.

| Tool | Version | Corpus cases | Smoke mutations | Baseline findings | FP per 1k doc lines | Date |
|---|---|---:|---:|---:|---:|---|
| docbind | 0.4.0 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |
| docbind | 0.3.0 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |
| docbind | 0.2.7 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |
| docbind | 0.2.6 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |
| docbind | 0.2.5 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |
| docbind | 0.2.4 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |
| docbind | 0.2.3 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |
| docbind | 0.2.1 | 16 | 13/13 | 0 | 0.000 | 2026-11-04 |

## Rules

- A row must name a runnable harness and a corpus snapshot. Self-reported numbers without both are not listed.
- Smoke mutations are not recall. Rows with n below 100 per cell must not be described as detection rates.
- Class mutations are the curated signature/return/visibility/move/kind matrix, not rename/value mutations.
- False positives are baseline findings on unmodified checkouts per 1,000 documentation lines.
- Misses stay visible. A tool with no submitted run is absent, not ranked last.

## Submit

Open an RFC per [RFC process](rfc.md) with the harness command, corpus commit, and raw report. There is currently one maintainer, so acceptance is a single-maintainer decision.

One entrant is a record, not a ranking. The corpus is maintainer-authored and has no independent evaluation. Third-party mutation generation is still missing.
