# Basic example

A three-file repository that shows the full loop:

1. `docbind lock` records `getUser` and `User.email`.
2. The code renames `getUser` to `get_user`.
3. `docbind check` reports the stale doc line.
4. `docbind fix --write` updates the doc and the lock.
5. `docbind check` exits clean.

Run it from the repository root:

```sh
npm run demo
```

The demo copies this directory to a temporary folder, so the checked-in example stays clean.
