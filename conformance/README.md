# Conformance suite

A language-neutral contract for `docbind check`. Each case is a self-contained project, a lock or no-lock setup, an optional source mutation, and the findings the checker must produce.

Run it from a repository checkout:

```sh
npm run conformance
npm run conformance -- ts-rename python-return
```

## Case layout

```
conformance/cases/<name>/
  case.json       # lock on/off, config, expected rule/severity pairs
  files/          # initial project
  mutation/       # copied over after locking; optional
```

`case.json`:

```json
{
  "lock": true,
  "config": { "javadoc": true },
  "expect": [{ "rule": "L3-reshaped", "severity": "error" }]
}
```

- `lock: false` skips lock generation. Use an inline `contract=` annotation when testing lock-free drift.
- `config` is merged over the default config.
- `expect` is matched as a multiset of rule and severity pairs. Extra findings fail the case.

## Add a case

1. Create the directory and the three inputs above.
2. Add the name to `cases.txt`.
3. Run `npm run conformance -- <name>` and confirm the expected rules.
4. Run `npm run conformance` for the full suite.

Cases are fixtures, not a statistical benchmark. Recall numbers live in [docs/recall.md](../docs/recall.md).

## Third-party use

The suite is versioned with the repository. A third-party implementation can consume the same directories: generate a lock when `lock` is true, apply `mutation`, run its checker, and compare rule/severity pairs. No docbind-specific runtime API is required.
