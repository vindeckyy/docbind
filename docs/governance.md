# Governance and exit path

See [GOVERNANCE.md](https://github.com/vindeckyy/docbind/blob/main/GOVERNANCE.md) for decision rules, succession, npm ownership, and how to add a maintainer.

## What happens if the project stops

- Annotations are ordinary HTML comments. `docbind strip --write` removes them.
- `docbind.json` and `docbind.lock.json` are optional project files; delete them.
- No source code imports docbind at runtime.
- The MIT license allows forks.
- `docbind migrate` and the published lock format keep old locks readable.

The tool is load-bearing only where a team chooses to make it so. This page exists so that choice can be reversed.

## Bus factor

The bus factor is one. A second maintainer is still wanted; see the checklist in the repository and `GOVERNANCE.md`.
