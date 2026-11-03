# Configuration

`docbind.json` is optional. Defaults cover a normal repository.

```json
{
  "docs": ["README.md", "docs/**/*.md", "docs/**/*.rst", "**/*.md", "**/*.rst"],
  "exclude": ["CHANGELOG.md", "docs/migration/**"],
  "languages": {
    "typescript": true,
    "python": true,
    "rust": true,
    "go": false,
    "rustdoc": false
  },
  "severity": {
    "L1-broken": "error",
    "L2-moved": "error",
    "L3-reshaped": "error",
    "L4-renamed": "error",
    "S1-deprecated": "off"
  },
  "maxFindings": 200,
  "minConfidence": 0.6,
  "docstrings": false,
  "asciidoc": false,
  "javadoc": false
}
```

## Historical docs

`CHANGELOG.md`, `HISTORY*`, `releases/**`, `docs/migration*`, and `docs/upgrade*` are excluded by default. Old names in those files are correct.

## Language switches

TypeScript, Python, and Rust are on by default. Go is off. The rustdoc JSON extractor is off because it runs `cargo +nightly rustdoc`, which executes build scripts and proc macros. Enable `rustdoc` only on trusted repositories. Turn off a language to reduce scan time or to avoid vendor generated sources.

## Docstrings

Set `"docstrings": true` to scan Python module, class, and function docstrings. Backticked symbols and Sphinx roles become anchors on the source file. It is off by default because docstrings mix prose with code tokens more loosely than dedicated docs.

## AsciiDoc

Set `"asciidoc": true` and include `.adoc` or `.asciidoc` paths in `docs`. Backtick and `+monospace+` literals become anchors, and `[source,<lang>]` blocks with `----` or `....` delimiters are parsed as fences. It is off by default because single backticks and plus signs are common in prose.

## Javadoc

Set `"javadoc": true` to extract public Java types and scan Javadoc comments. `{@link}`, `{@code}`, and backtick literals become anchors on the Java source file. Relative links such as `{@link #get()}` qualify with the enclosing type, and parameter lists with spaces are stripped before resolution. Java discovery is enabled by the same flag. Top-level and nested types keep their dotted path, so `Outer.Inner` methods resolve under both names. Types and members keep their visibility: `public`, `protected`, `private`, or package-private. `@interface` types are indexed as interfaces with the `annotation-type` flag, and their methods keep `defaultValue` plus typed `defaultKind`, `defaultLiteral`, and `defaultItems`. Java enums are indexed with their constants as `enumMember` symbols and aliases such as `Color.RED` and `Color#RED`. Constant constructor arguments are kept in `enumMembers[].args`, and members declared in constant class bodies extract under the constant path, for example `Color.GREEN#label`. `@Deprecated` becomes the `deprecated` flag; other annotations become `annotation:<Name>` flags, with normalized arguments appended as `annotation:<Name>(<args>)`. Shapes also store structured `annotations` entries with optional argument names, raw values, literal kinds, parsed literal values, and recursive `items` for arrays and nested annotations. It is off by default because Java projects usually keep their docs in a generator.

## Severity

Set a rule to `off`, `note`, `warning`, or `error`. Only `error` fails the default check. `--strict` fails on any finding.

## Lock behavior

The lock stores the shape the doc last asserted. `check` never writes it. `lock` updates bindings after doc edits. An engine upgrade prints one warning; use `lock --refresh` to rebind everything.

## Thresholds

`minConfidence` sets the binding floor. The default is `0.6`. The weights and the measured sweeps behind that value are in [Precision evidence](precision.md). Lower it only with corpus evidence: at `0.5` the corpus adds 17 anchors whose only evidence is a unique exported name, and `0.7` drops 158 tracked anchors.
