# docbind

Contract drift detection for symbol references in docs.

`docbind` binds symbol-shaped inline code in markdown and reStructuredText to exported code symbols. It stores the claim, then reports when the code contract changes and the sentence does not.

This is static analysis. No build, no project code execution, no network.

It is not a documentation linter. A passing check does not mean the prose is true. Read [Scope and limits](scope.md) first.

## Quick start

```sh
git clone https://github.com/vindeckyy/docbind.git
cd docbind
npm ci
npm run build
npm link
docbind init
docbind check
```

The `docbind` npm name belongs to an unrelated package. The scoped package `@vindeckyy/docbind` is not published yet.

Commit `docbind.lock.json`. Review findings in CI. Fix safe renames with `docbind fix --write`.

## Supported languages

| Language | Extraction | Default |
|---|---|---|
| TypeScript, JavaScript | TypeScript compiler API, syntactic | on |
| Python | bundled `ast` worker | on |
| Rust | built-in lexer and item parser | on |
| Go | built-in lexer and declaration parser | off |

Go is opt-in because many repositories vendor generated packages. Enable it with `"go": true`.

## What a finding means

The doc anchor did not change. The symbol contract it referenced did. The tool reports only breaking changes:

- removed symbol
- renamed symbol
- moved qualified path
- changed signature
- signature fence mismatch
- deprecation, when enabled

## Scope and limits

`docbind` checks symbol contracts, not prose claims. A backticked `getUser` binds the symbol; the tool verifies that it exists and that its parameters and return type still match. It does not check what the surrounding sentence asserts. A line saying `getUser` returns `Email` passes while the signature returns `string`.

Markdown and reStructuredText are the supported input formats. Python docstrings, AsciiDoc, and Javadoc are opt-in.

Examples are parsed, never run. Example-output drift is invisible.

## Next

- [Usage](usage.md)
- [Configuration](configuration.md)
- [Architecture](architecture.md)
- [Prior art](prior-art.md)
