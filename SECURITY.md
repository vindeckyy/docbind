# Security policy

## Supported versions

The current 0.2.x line receives security fixes.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository. Do not open a public issue for a suspected vulnerability.

Include:

- affected version or commit
- input that triggers the issue
- expected and actual behavior
- whether the issue requires a hostile repository, a hostile lock file, or a hostile markdown file

## Threat model

The full model is in [docs/threat-model.md](docs/threat-model.md).

`docbind` parses untrusted repository content in CI. It must not execute project code.

- TypeScript and Python extractors parse source.
- Rust and Go extractors use the bundled lexer and item parsers.
- The Python worker reads source with `ast.parse`. It does not import the project.
- The tool does not run `go`, package scripts, or build systems.
- `cargo` runs only when `languages.rustdoc` and `allowExec` are both enabled. Without `allowExec`, rustdoc extraction is skipped and a warning is printed.

Relevant risk classes:

- parser denial of service on malformed input
- path traversal through doc paths or configuration
- malicious lock files with extreme sizes or unexpected fields
- SARIF or terminal output injection through finding text

Report any of these privately.
