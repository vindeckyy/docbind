# Usage

## Commands

```text
docbind init
docbind check [--json] [--sarif <file>] [--github] [--all] [--strict] [--unbound]
              [--mode gate|strict] [--no-lock] [--allow-exec] [--no-cache]
              [--changed-only] [--base <rev>]
docbind lock [--check] [--diff] [--review] [--refresh]
docbind migrate [--check] [--json]
docbind fix [--write]
docbind explain <doc>:<line>[:<column>]
docbind adopt [--write] [--json]
docbind audit [--unbound] [--adopted] [--json]
docbind doctest [--json]
docbind probe [--json]
docbind strip [--write] [--json]
docbind stats
```

## First run

```sh
docbind init
docbind lock
docbind check
```

Explicit binding:

```html
<!-- docbind: symbol=src/users.ts#getUser -->
```

The path is project-relative. The part after `#` may be a bare name or a qualified member. Explicit bindings skip confidence scoring; if the symbol is missing or the name is ambiguous within that file, the check fails.

`docbind check --index docs/index.lsif` adds LSIF export monikers as binding-only symbols; `.scip` paths are decoded as SCIP protobuf. `--require-index` warns when no index symbols load. `docbind check --unbound` appends unbound tokens as SARIF/JSON notes. `--no-cache` bypasses `.docbind-cache/`. `--allow-exec` permits the rustdoc `cargo` call.

`docbind migrate` upgrades a lock file to the current format. `--check` exits 3 when migration is needed, so CI can reject stale lock formats without rewriting them.

`docbind lock --review` fails (exit 3) when a lock change is not coupled to an edited line in the corresponding doc. It is the review-time guard against blessing stale docs.

`docbind lock --diff` shows what a rebuild would change: additions, removals, symbol moves, and shape changes with old/new hashes. `--json` emits the same data for review tooling.

`docbind adopt` proposes annotations marked `adopted confidence=<score>`. They bind but stay advisory until a human removes the `adopted` tag. `docbind strip` removes annotations entirely for migration out.

`docbind check --require-coverage 0.8` fails with exit 3 below 80% verified annotation coverage. `--coverage-ratchet` compares against `.docbind-coverage.json`; `--write-coverage` updates the baseline. Coverage counts only human-asserted annotations, not adopted or inferred bindings. `--write` inserts them above the anchored lines; re-running is idempotent. `--contract` includes the current shape hash for lock-free checks.

`docbind check --no-lock` reads inline `contract=` assertions and ignores `docbind.lock.json`. The annotation must include the contract for reshape detection:

```html
<!-- docbind: symbol=src/users.ts#getUser contract=3edc239f12f5a59e -->
```

`docbind check --mode=strict` fails when unbound tokens fall on changed lines, but skips lines with hedging language such as "may", "typically", or "for example". `--mode=gate` is the default and keeps abstentions as notes.

`init` writes `docbind.json` and an empty lock. `lock` records every binding that passes the confidence threshold. `check` is read-only. `lock --check` verifies that the committed lock is current without writing it; use it in CI to catch stale locks.

## Doctests

`docbind doctest` runs commands from `doctests` in `docbind.json`. Each entry is an argv array, not a shell string:

```json
{
  "allowExec": true,
  "doctests": [
    { "name": "pytest", "command": "python3", "args": ["-m", "pytest", "--doctest-modules"], "docs": ["docs/python.md"] },
    { "name": "mdbook", "command": "mdbook", "args": ["test"], "docs": ["docs/rust.md"] }
  ]
}
```

Failures become `D1-doctest` findings. The command is skipped without `--allow-exec` or `"allowExec": true`. Commands run in the project root with a 120-second timeout and a 16 MiB output cap.

## Behavior probes

`docbind probe` runs a command inside a container to check documented return values for pure functions:

```json
{
  "allowExec": true,
  "probes": [
    {
      "name": "getUser",
      "image": "node:22-alpine",
      "command": "node",
      "args": ["-e", "import('./dist/users.js').then(m => { if (m.getUser('1').id !== '1') process.exit(1) })"],
      "docs": ["docs/api.md"]
    }
  ]
}
```

The container runs with `--network none`, a read-only root, a read-only mount of the repository, no extra capabilities, a 256 MiB memory cap, one CPU, and a 120-second timeout. Failures become `D2-probe` findings. The command requires both `--allow-exec` and `--allow-probes`; the second flag is deliberate because Docker is not a hostile-code boundary.

This is a process boundary, not a hardened multi-tenant sandbox. Run it only on trusted repositories.

## CI

```yaml
- run: npx --yes github:vindeckyy/docbind check --sarif docbind.sarif
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: docbind.sarif
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | clean |
| 1 | findings at or above the configured severity |
| 2 | config, IO, or parse failure that prevents a trustworthy run |
| 3 | lock is out of date |

For pull requests, commit the lock after changing docs:

```sh
docbind lock
docbind lock --check
```

## Fixing

```sh
docbind fix
docbind fix --write
```

The fix engine rewrites rename tokens and moved qualified paths. It refuses signature changes. It preserves bytes outside the span.

## Debugging a finding

```sh
docbind explain docs/api.md:42
```

The output lists candidates, score evidence, vetoes, and the lock entry. Use it before filing a bug.

## Rust example

```rust
pub fn get_user(id: &str) -> Option<User> { ... }

pub struct User {
    pub id: String,
}

pub trait Repo {
    fn get(&self, id: &str) -> Option<User>;
}
```

Docs can reference `get_user`, `User`, `User.id`, or `Repo.get`.

## Go example

```go
func GetUser(id string) (*User, error) { ... }

type User struct {
    ID string
}

func (u *User) Rename(name string) error { ... }
```

Enable Go in `docbind.json`, then docs can reference `GetUser`, `User`, `User.ID`, or `User.Rename`.
