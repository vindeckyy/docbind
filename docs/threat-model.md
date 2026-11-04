# Threat model

`docbind` reads untrusted repository content in CI. Its job is static analysis, not execution.

## Default posture

- The checker does not run project code, package scripts, build systems, or tests.
- TypeScript, Rust, Go, and Java extractors parse source text.
- The Python extractor starts `python3` and runs a bundled worker that calls `ast.parse`. It never imports project modules.
- Git commands run only for `--changed-only`, `--mode=strict`, and `--base`; they are read-only diffs.
- `languages.rustdoc` is off by default. Enabling it requires `--allow-exec` or `"allowExec": true` because it invokes `cargo`.
- `docbind probe` requires `--allow-exec` and Docker. It runs a configured command with no network, a read-only root, a read-only repo mount, a non-root user, memory and CPU caps, and a timeout. It is not a hardened multi-tenant sandbox.

## Assets

- documentation and source files in the scanned repository
- `docbind.lock.json`
- `docbind.json`
- terminal, JSON, and SARIF output consumed by CI

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Build-script execution through Rust tooling | `cargo` is gated behind `allowExec`; without it, rustdoc extraction is skipped with a warning. |
| Probe escape | Probes run only behind `allowExec` in Docker with no network, a read-only root and repo mount, non-root user, and resource limits. |
| Parser denial of service | Parsers operate per file; malformed input increments `parseFailures` instead of retrying. |
| Path traversal through docs or config globs | Paths are resolved relative to the project root; configuration cannot set an output path outside it. |
| Hostile lock file | The lock is schema-validated with strict objects; `docbind migrate` rejects newer schemas and drops unknown fields. |
| SARIF/terminal injection | Finding text is emitted as data; SARIF is JSON, and the human reporter does not interpret escape sequences from source text. |
| Secret leakage in findings | Messages contain symbol names, shapes, and doc paths, not environment values or file contents beyond the documented shape. |

## Explicit non-goals

- Sandboxing a hostile compiler or package manager. Do not enable `allowExec` on untrusted pull requests.
- Proving that prose is true.
- Preventing a malicious contributor from editing the lock or docs. Review those diffs.

## Reporting

See [SECURITY.md](https://github.com/vindeckyy/docbind/blob/main/SECURITY.md). Do not open a public issue for a suspected vulnerability.
