# Demo

The example in `examples/basic` has one source file and one doc page.

```text
$ docbind lock
wrote 3 anchors, 0 tombstones

$ docbind check
docs/api.md:3  error  L4-renamed  getUser was renamed to get_user
  code: src/users.ts:6
  fix:  docbind fix --write
1 docs, 1 code files, 4 symbols, 3 anchors, 2 bound
1 errors, 0 warnings, 1 total

$ docbind fix --write
1 fixable findings
fixed docs/api.md
1 docs, 1 code files, 4 symbols, 3 anchors, 3 bound
0 errors, 0 warnings, 0 total

$ docbind check
1 docs, 1 code files, 4 symbols, 3 anchors, 3 bound
0 errors, 0 warnings, 0 total
```

Run it from the repository root:

```sh
npm run demo
```

The script copies the example to a temporary directory. The checked-in example stays clean.
