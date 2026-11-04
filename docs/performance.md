# Performance

`npm run bench` checks three pinned corpus checkouts five times each and reports the median. Measured on 2026-11-03, Apple silicon macOS, Node 26.

| Repository | Code files | Docs | Symbols | Anchors | Median check | Anchors per second |
|---|---:|---:|---:|---:|---:|---:|
| encode/httpx | 23 | 23 | 372 | 2818 | 179 ms | 15,700 |
| spf13/viper | 33 | 2 | 331 | 167 | 52 ms | 3,200 |
| dtolnay/thiserror | 19 | 1 | 132 | 162 | 278 ms | 580 |

`check` includes code discovery, surface extraction, doc parsing, resolution, and lock correlation. It does not include the first cold filesystem read or the corpus download.

Runtime tracks code parsing more than anchor count. thiserror is the slowest case despite the fewest anchors because Rust extraction parses 19 files with a hand-written item parser.

## Cached 100k-LOC check

`npm run perf -- --files=340 --functions=100` generates a synthetic TypeScript repository of about 102,000 lines across 340 files, then runs `checkProject` cold and warm on the same host.

Measured on 2026-11-04, Apple silicon macOS, Node 26:

| Run | Time |
|---|---:|
| Cold, empty cache | 0.68 s |
| Warm, cache hit | 0.29 s |
| Target | < 2.00 s |

The surface cache is keyed by engine version, extractor config, file paths, and file content hashes. Any code edit invalidates the whole surface cache, so the warm number represents repeated runs on unchanged code, not incremental editing. The synthetic tree is regular TypeScript; parser-heavy Rust trees are slower.

The benchmark is not part of CI. Numbers vary by machine; compare on the same host before and after a change.
