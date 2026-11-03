# Usage

## Commands

```text
docbind init
docbind check [--json] [--sarif <file>] [--github] [--all] [--strict] [--changed-only] [--base <rev>]
docbind lock [--check] [--refresh]
docbind fix [--write]
docbind explain <doc>:<line>[:<column>]
docbind stats
```

## First run

```sh
npx docbind init
npx docbind lock
npx docbind check
```

`init` writes `docbind.json` and an empty lock. `lock` records every binding that passes the confidence threshold. `check` is read-only.

## CI

```yaml
- run: npx docbind check --sarif docbind.sarif
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
npx docbind lock
npx docbind lock --check
```

## Fixing

```sh
npx docbind fix
npx docbind fix --write
```

The fix engine rewrites rename tokens and moved qualified paths. It refuses signature changes. It preserves bytes outside the span.

## Debugging a finding

```sh
npx docbind explain docs/api.md:42
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
