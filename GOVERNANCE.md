# Governance

docbind is maintained by Hayden ([@vindeckyy](https://github.com/vindeckyy)). This file exists so users can see the decision rules, the bus-factor risk, and the exit path before they make the tool load-bearing.

## Decisions

- Changes to binding semantics, the lock format, severity defaults, coverage semantics, or execution behavior need an RFC ([process](docs/rfc.md)).
- With one maintainer, acceptance is a single-maintainer decision. That risk is published, not hidden.
- Releases are tagged, gated by CI, and published by the tag workflow.
- A second maintainer is wanted. Until one exists, assume the bus factor is one.

## Succession

If the maintainer stops:

1. The repository remains MIT-licensed. Forks are allowed and expected.
2. The lock format carries a semver `format` field and `docbind migrate` upgrades it.
3. Annotations are plain HTML comments. `docbind strip --write` removes them without touching prose or code.
4. `docbind.json` and `docbind.lock.json` can be deleted. No source code imports docbind.
5. The conformance suite and golden snapshots are in the repository so a fork can verify behavior.

No hosted service, private registry, or proprietary lock-in exists.

## npm ownership

The unscoped `docbind` name is held by an unrelated package. The scoped package `@vindeckyy/docbind` is the intended registry name. Publishing requires npm credentials and ownership of the `@vindeckyy` scope. Until that exists, GitHub tags, release binaries, and checksums are the distribution path.

## Adding a maintainer

A second maintainer needs repository write access and npm publish access. The current maintainer must grant both. This cannot be automated and is not done yet.

## Changing this document

Governance changes follow the RFC process. A governance change that reduces the exit path is a breaking change.
