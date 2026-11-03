# Changelog

All notable changes are recorded here. The format follows Keep a Changelog and the project uses semantic versioning.

## [0.1.76] - 2026-11-03

### Added

- Constant initialisers use their parsed field type, so `static final int X = 7 / 2` evaluates to `3`.
- `long`, `short`, and `byte` constants follow the same rule.
- Annotation defaults that reference such a constant inherit the evaluated value.
- Corpus adds `Constants.HALF = 7 / 2`; editing `2` to `4` must produce `L3-reshaped` on `Marker#halfConstant`.

### Changed

- Corpus mutations: 101 to 102; `java-javadoc-fixture` runs 30 mutations with 25 anchors, all hitting with zero collateral.
- Branch coverage stays at 95.69%; line coverage at 99.24%.

### Limits

- Floating field types still use floating division, which differs from Java when both operands are integers.
- Function calls, casts, and bitwise operators stay unevaluated.
- The unscoped npm package remains unavailable.

## [0.1.75] - 2026-11-03

### Added

- Annotation defaults whose method returns `int`, `long`, `short`, or `byte` use truncating integer division, for example `7 / 2` becomes `3`.
- Decimal points and `f`/`d` suffixes switch that expression back to floating division; `L` suffixes stay integral.
- Corpus adds `Marker.intDiv()` with default `7 / 2`; editing `2` to `4` must produce `L3-reshaped`.

### Changed

- Corpus mutations: 100 to 101; `java-javadoc-fixture` runs 29 mutations with 24 anchors, all hitting with zero collateral.
- Branch coverage rose to 95.69%; line coverage is 99.24%.

### Limits

- Integer division applies to annotation defaults only, not to constant initialisers.
- Function calls, casts, and bitwise operators stay unevaluated.
- The unscoped npm package remains unavailable.

## [0.1.74] - 2026-11-03

### Added

- Java annotation defaults evaluate numeric `+`, `-`, `*`, and `/`, parentheses, and unary minus.
- `+` concatenates strings, numbers, and string constants.
- Constants initialised with arithmetic now resolve, including defaults that reference them.
- Arithmetic nests inside annotation arrays and nested annotation arguments.
- Corpus adds `Marker.arithmetic()` with default `5 + 2`; editing `2` to `3` must produce `L3-reshaped`.

### Fixed

- String literals are recognised only when the closing quote is the final character, so `"a" + "b"` is no longer classified as the single string `a" + "b`.

### Changed

- Corpus mutations: 99 to 100; `java-javadoc-fixture` runs 28 mutations with 23 anchors, all hitting with zero collateral.
- Branch coverage rose to 95.68%; line coverage is 99.24%.

### Limits

- Division is floating point, not Java integer division.
- Function calls, casts, and bitwise operators stay unevaluated.
- The unscoped npm package remains unavailable.

## [0.1.73] - 2026-11-03

### Added

- Java annotation defaults resolve `static final` constants declared in any file of the same project, not just the declaring file.
- Constants are collected across parsed files, then defaults are evaluated in a second pass so declaration order does not matter.
- Corpus adds `SharedConstants.NAME` in a separate file; editing it must produce `L3-reshaped` on `Marker#fromShared`.

### Changed

- Corpus mutations: 98 to 99; `java-javadoc-fixture` runs 27 mutations with 22 anchors, all hitting with zero collateral.
- Corpus anchors: 3388 to 3389; bound 821 to 822.

### Limits

- Cross-file resolution is limited to the files extracted for the project; a constant in a file not scanned stays unresolved.
- Simple-name collisions across files resolve to the last parsed definition; qualified names avoid the collision.
- The unscoped npm package remains unavailable.

## [0.1.72] - 2026-11-03

### Added

- Annotation defaults resolve static final literals declared in the same file, for example `default Constants.NAME`.
- Resolution covers string, number, and boolean constants; unresolved references leave `evaluatedDefault` absent.
- Enum defaults resolve only against enums declared in the file, so `Mode.FAST` stays evaluable while `Missing.NAME` does not.
- Corpus supports token-located constant mutations; editing `Constants.NAME` must produce `L3-reshaped` on `Marker#fromConstant`.

### Fixed

- Java field names are read from the token before `=`, so `static final boolean ON = true` no longer extracts the field name `true`.

### Changed

- Corpus mutations: 97 to 98; `java-javadoc-fixture` runs 26 mutations with 21 anchors, all hitting with zero collateral.
- Branch coverage rose to 95.6%; line coverage to 99.29%.

### Limits

- Only same-file constants resolve; cross-file constant references stay unresolved.
- The unscoped npm package remains unavailable.

## [0.1.71] - 2026-11-03

### Added

- Opt-in Java annotation default evaluation with `"javaDefaults": true`.
- Annotation methods gain `evaluatedDefault` for strings, numbers, booleans, enum names, class names, arrays, and nested annotation objects.
- Shape comparison reports `evaluated default changed` as a breaking reshape.
- Corpus supports token-located default mutations; `Marker.value` default `"default"` is edited to `"other"` and must yield `L3-reshaped`.

### Changed

- Corpus harness config writing is one helper instead of three duplicated blocks.
- Corpus mutations: 96 to 97; `java-javadoc-fixture` runs 25 mutations, all hitting with zero collateral.

### Limits

- Unsupported default expressions stay raw and are not evaluated.
- The unscoped npm package remains unavailable.

## [0.1.70] - 2026-11-03

### Changed

- Replaced in-bounds `?? ""` fallbacks in the Java parser with explicit index guards, removing every uncovered branch in `src/surface/java.ts`.
- Parameter annotation skipping now consumes exactly the annotation name, arguments, and `final` modifiers instead of scanning to a space the lexer does not emit.
- Annotated parameters now report their real type; previously the type was blank for `@Deprecated String old`.
- Branch coverage rose from 95.33% to 95.53%; line coverage from 99.26% to 99.28%.

### Added

- Tests for missing annotation names at end of input, dotted annotation names, parameter annotations, `final` parameters, malformed parameter lists, unnamed methods, and unnamed fields.

### Limits

- The unscoped npm package remains unavailable.

## [0.1.69] - 2026-11-03

### Changed

- Annotation mutations accept an `element` index, so `@Routes` array elements are selected by position instead of by unique string value.
- The last raw value mutation is gone; every Java fixture edit now locates its target through the token stream.
- Mutation count stays 96: 20 renames and 4 token-located edits for the Java fixture.

### Limits

- Index selection still requires a unique annotation name and a string literal at that position.
- The unscoped npm package remains unavailable.

## [0.1.68] - 2026-11-03

### Changed

- The `@Command(value = "run")` mutation is now token-located like the `@Routes` mutation, instead of a raw text replacement.
- The `RED("red")` enum-argument mutation is now token-located: the harness finds the constant, bounds its constructor arguments, and replaces the unique matching string.
- Raw value mutations are now limited to the `@Routes({"/a", "/b"})` case.
- Mutation count stays 96; type mix is now 20 renames, 3 token-located edits, and 1 raw value edit for the Java fixture.

### Limits

- Token-located matching requires simple names and a unique string literal target.
- The unscoped npm package remains unavailable.

## [0.1.67] - 2026-11-03

### Added

- Corpus harness supports annotation mutations located through the Java token stream: find `@Annotation`, bound its parentheses, select the unique string literal with the requested value, and replace it.
- `java-javadoc-fixture` edits the first `@Routes` array element from `/a` to `/z` through that path and requires `L3-reshaped`.

### Changed

- Corpus mutations: 95 to 96; `java-javadoc-fixture` runs 24 mutations, all hitting with zero collateral.

### Limits

- Annotation mutation matching handles simple annotation names and one string target; it fails loudly on zero or multiple matches.
- The unscoped npm package remains unavailable.

## [0.1.66] - 2026-11-03

### Added

- Third corpus value mutation edits an annotation array element: `@Routes({"/a", "/b"})` to `{"/a", "/c"}` and must yield `L3-reshaped`.

### Changed

- Corpus mutations: 94 to 95; `java-javadoc-fixture` runs 23 mutations, all hitting with zero collateral.

### Limits

- Value mutations remain literal text replacements.
- The unscoped npm package remains unavailable.

## [0.1.65] - 2026-11-03

### Added

- Corpus value mutations now cover annotation arguments: `@Command(value = "run")` is edited to `"go"` and must yield `L3-reshaped`.
- Shape tests assert that annotation-flag edits are breaking.

### Changed

- Corpus mutations: 93 to 94; `java-javadoc-fixture` runs 22 mutations, all hitting with zero collateral.

### Limits

- Value mutations remain literal text replacements.
- The unscoped npm package remains unavailable.

## [0.1.64] - 2026-11-03

### Added

- Corpus harness supports value mutations with an expected rule; failures count as misses.
- `java-javadoc-fixture` edits `RED("red")` to `RED("crimson")` and requires an `L3-reshaped` finding.
- Enum constant symbols carry typed constructor arguments in `shape.enumArgs`, so argument edits are contract-enforced.
- Shape comparison reports `enum arguments changed` for enum member argument edits.

### Changed

- Corpus mutations: 92 to 93; the new value mutation hits with zero collateral.

### Limits

- Value mutations are literal text replacements; they do not parse the file being edited.
- The unscoped npm package remains unavailable.

## [0.1.63] - 2026-11-03

### Changed

- Added malformed-input tests for unclosed enum argument lists, unclosed enum constant bodies, unterminated annotations, unterminated methods, missing annotation names, and trailing enum annotations.
- Removed five `v8 ignore` markers that now have real coverage and restored three on paths the parser cannot reach while the enclosing type still parses.
- Branch coverage rose from 95.03% to 95.32%; line coverage from 99.18% to 99.26%.

### Added

- Nested `@interface` declarations without modifiers now extract.

### Limits

- The unscoped npm package remains unavailable.

## [0.1.62] - 2026-11-03

### Added

- Java enum constant constructor arguments are typed with the annotation literal classifier.
- `enumMembers[].argValues` holds each positional argument as `{ value, kind, literal, items }`.
- Unit and fixture assertions cover string, number, and boolean constant arguments.

### Limits

- Argument values keep their source text alongside the typed literal.
- The unscoped npm package remains unavailable.

## [0.1.61] - 2026-11-03

### Added

- Java enum constants keep constructor arguments in `enumMembers[].args`.
- Members declared in an enum constant class body extract under the constant path, for example `Color.GREEN#label`, with dotted and `#` aliases.
- `java-javadoc-fixture` adds constant arguments and a constant-body method and detects 20 of 20 mutations.

### Limits

- Constructor arguments are stored as normalized source text, not typed.
- The unscoped npm package remains unavailable.

## [0.1.60] - 2026-11-03

### Added

- Java enums extract as `enum` symbols with typed `enumMembers`.
- Enum constants extract as `enumMember` symbols with dotted and `#` aliases such as `Color.RED` and `Color#RED`.
- Constants with arguments or class bodies are handled.
- `java-javadoc-fixture` adds a `Color` enum with two constants and detects 19 of 19 mutations.

### Fixed

- Enum member symbols always carry a contract-flag array, so deprecation checks cannot crash.

## [0.1.59] - 2026-11-03

### Added

- Annotation default values are typed with the same literal classifier as annotation arguments.
- `defaultKind`, `defaultLiteral`, and `defaultItems` sit alongside the raw `defaultValue`.
- Unit and fixture assertions cover string, number, boolean, enum, and array defaults.
- `java-javadoc-fixture` adds boolean and array defaults and detects 17 of 17 mutations.

### Limits

- Default values are still not evaluated; only their source literal is classified.
- The unscoped npm package remains unavailable.

## [0.1.58] - 2026-11-03

### Added

- Java `@interface` declarations are indexed as annotation types with the `annotation-type` flag.
- Annotation type methods keep their `defaultValue` source text.
- Nested annotation types are supported through the same path rules as other nested types.
- `java-javadoc-fixture` adds a marker annotation with two methods and detects 15 of 15 mutations.

### Limits

- Default values are stored as source text, not evaluated or typed.
- The unscoped npm package remains unavailable.

## [0.1.57] - 2026-11-03

### Added

- Java annotation arrays and nested annotations expand recursively into `items`.
- Array elements keep their own names, kinds, literals, and nested items.
- Nested annotation arguments are parsed with the same structure as top-level arguments.
- `java-javadoc-fixture` adds a nested annotation argument and keeps 13 of 13 mutations.

### Limits

- Recursion follows source text only; cyclic annotation types are not evaluated.
- The unscoped npm package remains unavailable.

## [0.1.56] - 2026-11-03

### Added

- Java annotation arguments carry literal kinds: string, number, boolean, enum, class, array, annotation, or expression.
- Parsed literal values are stored when a safe scalar exists: unquoted strings, numbers, and booleans.
- Quoted strings are decoded with JSON semantics; character literals and unusual escapes fall back safely.
- `java-javadoc-fixture` adds an array-argument route method and detects 13 of 13 mutations.

### Limits

- Arrays and nested annotations keep only their kind and raw value; their elements are not expanded.
- The unscoped npm package remains unavailable.

## [0.1.55] - 2026-11-03

### Added

- Java shapes store structured annotation entries alongside contract flags.
- Positional arguments become `{ value }`; named arguments become `{ name, value }`.
- Commas inside strings or nested brackets do not split arguments.
- `java-javadoc-fixture` adds a named-argument command method and detects 12 of 12 mutations.

### Limits

- Argument values stay as source text, including quotes; no type coercion.
- The unscoped npm package remains unavailable.

## [0.1.54] - 2026-11-03

### Added

- Java annotation arguments are captured into contract flags, for example `annotation:SuppressWarnings("unused")`.
- Whitespace in arguments is normalized; string values are preserved.
- `java-javadoc-fixture` adds an annotated helper method and detects 11 of 11 mutations.

### Limits

- Annotation arguments are stored as raw normalized text, not parsed names and values.
- The unscoped npm package remains unavailable.

## [0.1.53] - 2026-11-03

### Added

- Java extraction includes non-public top-level and nested types.
- Type shapes record `public`, `protected`, `private`, or `package` visibility.
- `java-javadoc-fixture` adds a package-private top-level type referenced from Javadoc and detects 10 of 10 mutations.

### Limits

- Annotation arguments are ignored; only the annotation name is recorded.
- The unscoped npm package remains unavailable.

## [0.1.52] - 2026-11-03

### Added

- Java extraction includes non-public members: protected, private, and package-private methods and fields.
- Member shapes record `public`, `protected`, `private`, or `package` visibility.
- `java-javadoc-fixture` includes private methods referenced from Javadoc and detects 9 of 9 mutations.

### Limits

- Java top-level and nested types are still extracted only when public.
- Annotation arguments are ignored; only the annotation name is recorded.
- The unscoped npm package remains unavailable.

## [0.1.51] - 2026-11-03

### Added

- Java declarations carry annotations in `contractFlags`.
- `@Deprecated` maps to the `deprecated` flag and drives S1 findings.
- Other annotations map to `annotation:<SimpleName>`; `@Override` is skipped.
- Annotations on types, methods, fields, and nested types are captured.
- `java-javadoc-fixture` adds a deprecated annotated method and now detects 6 of 6 mutations.

### Limits

- Java extraction still skips non-public members.
- Annotation arguments are ignored; only the annotation name is recorded.
- The unscoped npm package remains unavailable.

## [0.1.50] - 2026-11-03

### Added

- Java extraction covers public nested classes and interfaces.
- Nested symbols keep dotted paths and qualified aliases such as `Outer.Inner`, `Outer.Inner#run`, and `example.Outer.Inner.run`.
- Duplicate nested names in different outer types stay distinct through path-based ids and qualified names.
- `java-javadoc-fixture` now has two outer types each with an `Inner` class and detects 5 of 5 mutations.

### Improved

- Javadoc class comments attach to the immediately following declaration, so nested class docs resolve against the nested type.

### Limits

- Java extraction still skips non-public members and annotations.
- The unscoped npm package remains unavailable.

## [0.1.49] - 2026-11-03

### Fixed

- Javadoc links with parameter lists that contain spaces, such as `{@link #get(int, String)}`, no longer truncate at the first space. The parser captures the full target and strips the parameter list.
- Links with labels, such as `{@link Client#get(int) the getter}`, resolve to `Client#get`.

### Improved

- `java-javadoc-fixture` uses a spaced parameter list and stays at 3 of 3 anchors bound and 2 of 2 mutations.

### Limits

- The unscoped npm package remains unavailable.

## [0.1.48] - 2026-11-03

### Added

- Javadoc relative links such as `{@link #get()}` resolve with the enclosing type as `Client#get()` instead of a bare method name.
- Javadoc comments take the innermost enclosing type; class-level comments attach to the following type.
- `java-javadoc-fixture` now has two classes with same-named methods; the enclosing-type link stays bound at 3 of 3 anchors and detects 2 of 2 mutations.

### Limits

- Javadoc links with parameter lists that contain spaces, such as `{@link #get(int, String)}`, are truncated at the first space.
- The unscoped npm package remains unavailable.

## [0.1.47] - 2026-11-03

### Added

- Opt-in Javadoc scanning via `"javadoc": true`.
- Minimal Java surface extraction: public classes, interfaces, methods, fields, and constructors.
- Javadoc `{@link}`, `{@code}`, and backtick literals become anchors on the Java source file.
- Local `java-javadoc-fixture`: 2 of 2 anchors bound, 2 of 2 mutations detected.

### Limits

- Java extraction covers public top-level types and their public members. Nested types, annotations, and non-public members are skipped.
- The unscoped npm package remains unavailable.

## [0.1.46] - 2026-11-03

### Added

- Opt-in AsciiDoc scanning via `"asciidoc": true` and `.adoc` / `.asciidoc` doc globs.
- Backtick and `+monospace+` literals plus `[source,<lang>]` blocks with `----` or `....` delimiters.
- Local `python-asciidoc-fixture`: 5 of 5 anchors bound, 3 of 3 mutations detected.

### Limits

- AsciiDoc is off by default because single backticks and plus signs are common in prose.
- Javadoc is still unread.
- The unscoped npm package remains unavailable.

## [0.1.45] - 2026-11-03

### Added

- Opt-in Python docstring scanning via `"docstrings": true`.
- Module, class, function, and method docstrings contribute anchors for single or double backtick literals and Sphinx roles.
- Local `python-docstrings-fixture`: 2 of 2 anchors bound, 2 of 2 mutations detected.
- `docs/configuration.md` and the scope sections document the flag and its default.

### Limits

- Docstrings remain off by default because they mix prose with code tokens more loosely than dedicated docs.
- AsciiDoc and Javadoc are still unread.
- The unscoped npm package remains unavailable.

## [0.1.44] - 2026-11-03

### Fixed

- Threshold sweep recall used the union of mutation targets across floors as its denominator. Each floor locks its own symbols, so targets absent from a floor counted as misses. Recall is now hits divided by that floor's selections.
- `docs/precision.md` tables show per-floor selections. Every selected target is detected at every floor; higher floors lose tracked anchors, not detections.
- Corrected the 0.1.43 claim that two union targets were never detected. No target fails at any floor.

## [0.1.43] - 2026-11-03

### Added

- `docs/precision.md` now publishes a full-corpus threshold sweep alongside the local one.
- `npm run thresholds -- --all` covers every pinned repository; raw rows are in `corpus/precision-external.json`.

### Changed

- The default floor stays at 0.60. The sweep shows 0.50 adds 17 anchors whose only evidence is a unique exported name, which the precision model treats as prose. Floors at 0.70 and above track fewer anchors.

### Limits

- The full sweep samples six floors; a finer scan between 0.60 and 0.70 could tighten the edge.
- The unscoped npm package remains unavailable.

## [0.1.42] - 2026-11-03

### Added

- `minConfidence` config field sets the binding floor; default is now 0.60, down from an engine constant of 0.70.
- reStructuredText input: double-backtick literals, roles such as `:func:` and `:attr:`, and `code-block` directives.
- `docs/precision.md` publishes scoring weights, the threshold sweep, and the derivation of the default floor.
- `docs/performance.md` publishes median check runtime for httpx, viper, and thiserror.
- `npm run corpus:fixtures` runs the network-free fixtures in CI and fails on baseline findings, doc-edit noise, missed mutations, or collateral findings.
- Corpus report now includes a name-only false-positive count for comparison against a naive baseline.
- Corpus rows publish bind rate.

### Changed

- The default binding floor moved to 0.60 after the sweep showed 0.65 is where mutation recall first drops. Full-corpus bound anchors rose from 417 to 559 on httpx, 10 to 14 on anyhow, and 12 to 23 on thiserror with zero baseline findings.
- The prior-art page now includes that empirical baseline comparison.

### Fixed

- Corpus cache hits rewrite `docbind.json`, so a previous threshold run cannot leak into later runs.

### Limits

- The threshold sweep covers 72 local anchors, not the external repositories. The fixtures do not separate floors from 0.30 through 0.60.
- Docstrings, AsciiDoc, and Javadoc are still unread.
- Prose claims and example execution remain out of scope.
- The unscoped npm package remains unavailable.

## [0.1.41] - 2026-11-03

### Added

- Python fence parameters are typed from annotations, call arguments, and overridden base-class methods.
- `README.md` and `docs/index.md` now state the scope boundary: contract shape only, markdown only, no execution.

### Improved

- httpx corpus bind rate rose from 405 to 417 anchors with zero baseline findings.
- Python fixture grew from 4 to 9 anchors and from 2 to 5 detected mutations.
- Corpus now detects 64 of 64 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.08% to 95.1%.

### Limits

- Prose claims are not checked. A sentence can misstate a return type or behavior and still pass.
- Docstrings, reStructuredText, AsciiDoc, and Javadoc are not read.
- Examples are never executed, so example-output drift is invisible.
- The unscoped npm package remains unavailable.

## [0.1.40] - 2026-11-03

### Added

- Python fence inference resolves attribute chains through class property types, so `response.request.method` rewrites to `Request.method`.
- Python instance attributes assigned in `__init__` are extracted as typed properties, such as `self.method = method`.
- Bare function calls use return annotations, so `response = get_response()` types `response`.

### Fixed

- Instance-attribute property body hashes use the initializer value, so renames produce `L4-renamed` instead of `L1-broken`.
- Python predeclared builtins such as `print` are filtered from fence anchors.

### Improved

- httpx corpus bind rate rose from 379 to 405 anchors with zero baseline findings.
- New Python fixture binds 3 of 4 anchors and detects 2 of 2 mutations, including an attribute-chain rename.
- Corpus now detects 61 of 61 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.06% to 95.08%.

### Limits

- Python inference remains assignment-local and does not type unannotated function parameters.
- The unscoped npm package remains unavailable.

## [0.1.39] - 2026-11-03

### Added

- Go fence inference types map-index values from the map's element type, so `providers["default"].Get()` resolves through `map[string]*Viper`.
- Map parameters, `var` declarations, and `:=` map literals all contribute element types.
- Go predeclared types such as `string`, `any`, and `error` are filtered from fence anchors.

### Improved

- Go fixture grew from 43 to 45 bound anchors and from 27 to 28 detected mutations.
- Corpus now detects 58 of 58 seeded mutations with zero collateral findings.
- Viper anchors fell from 189 to 167 through builtin filtering, while keeping 94 bound symbols.
- Branch coverage rose from 95.01% to 95.06%.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.38] - 2026-11-03

### Added

- Go fence inference carries return types from interface method calls, so `v := h.Load()` types `v` from `Load() *Viper`.
- Local Go fixture covers an interface method result with a distinct mutation.

### Improved

- Go fixture grew from 40 to 43 bound anchors and from 26 to 27 detected mutations.
- Corpus now detects 58 of 58 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.37] - 2026-11-03

### Added

- Go fence inference matches inline interface parameters to source interfaces by method set.
- Local Go fixture covers an inline-interface method with a distinct mutation.
- Lock entries store doc line numbers so inferred token changes can still correlate with removed symbols.

### Improved

- Go fixture grew from 39 to 40 bound anchors and from 25 to 26 detected mutations.
- Corpus now detects 57 of 57 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.36] - 2026-11-03

### Added

- Go fence inference handles anonymous function parameters such as `func(v *Viper) { v.Method() }`.
- Local Go fixture covers an anonymous callback method with a distinct mutation.

### Improved

- Go fixture grew from 36 to 39 bound anchors and from 24 to 25 detected mutations.
- Corpus now detects 56 of 56 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.35] - 2026-11-03

### Added

- Go fence inference types type assertions such as `v := viper.Default.(*Viper)`.
- Local Go fixture covers an asserted method with a distinct mutation.

### Improved

- Go fixture grew from 33 to 36 bound anchors and from 23 to 24 detected mutations.
- Corpus now detects 55 of 55 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.34] - 2026-11-03

### Added

- Real thiserror-derived fixture pinned to `thiserror` 2.0.21.
- Its documented generated `Outer.source()` method binds through the opt-in rustdoc extractor and is mutated successfully.

### Improved

- Real thiserror fixture binds 1 of 1 anchors and detects 1 of 1 mutation.
- Corpus now detects 54 of 54 seeded mutations with zero collateral findings.

### Limits

- The thiserror fixture fetches its pinned dependency through Cargo. Corpus runs need network access.
- npm publication remains unresolved.

## [0.1.33] - 2026-11-03

### Added

- The opt-in rustdoc extractor resolves impl targets from `resolved_path.path`, so proc-macro-generated trait impl methods attach to their generated type.
- Proc-macro fixture covers a generated trait impl method with a mutation.

### Improved

- Proc-macro fixture grew from 2 to 3 bound anchors and from 0 to 1 detected mutation.
- Corpus now detects 53 of 53 seeded mutations with zero collateral findings.

### Limits

- General proc-macro output still requires the opt-in rustdoc extractor.
- npm publication remains unresolved.

## [0.1.32] - 2026-11-03

### Added

- Go fence inference keeps declared types from qualified package-variable selectors such as `var Qualified = other.Selected`.
- Local Go fixture covers a qualified selected variable with a distinct mutation.

### Improved

- Go fixture grew from 31 to 33 bound anchors and from 22 to 23 detected mutations.
- Corpus now detects 52 of 52 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.31] - 2026-11-03

### Added

- Go fence inference follows struct field chains, so `cfg := Config{Viper: New()}` resolves `cfg.Viper.Field()` through `Config.Viper -> Viper.Field`.
- Local Go fixture covers a struct-field method with a distinct mutation.

### Improved

- Go fixture grew from 27 to 31 bound anchors and from 21 to 22 detected mutations.
- Corpus now detects 51 of 51 seeded mutations with zero collateral findings.
- The new struct-field selector binds to the target method instead of a local struct path.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.30] - 2026-11-03

### Added

- Go fence inference types multi-return helper calls such as `v, err := loadViper()` from the first return type.
- Tuple return types such as `(*Viper, error)` are normalized to `Viper`.
- Local Go fixture covers a multi-return helper with a distinct mutation.

### Improved

- Go fixture grew from 25 to 27 bound anchors and from 19 to 21 detected mutations.
- Corpus now detects 50 of 50 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type values supplied from outside the fence.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.29] - 2026-11-03

### Added

- Go fence inference reads return types from same-fence helper functions.
- `v := loadViper()` types `v` when `func loadViper() *Viper` appears in the fence.
- Local Go fixture covers a helper-return method with a distinct mutation.

### Improved

- Go fixture grew from 22 to 25 bound anchors and from 18 to 19 detected mutations.
- Corpus now detects 48 of 48 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.03% to 95.05%.

### Limits

- Go fence inference does not type externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.28] - 2026-11-03

### Added

- Go fence inference types package-level variables from constructor calls and composite literals.
- `var Default = New()` lets `v := viper.Default` resolve `v.Get()` to `Viper.Get`.
- Local Go fixture covers a package variable with a distinct mutation.

### Improved

- Go fixture grew from 20 to 22 bound anchors and from 16 to 18 detected mutations.
- Corpus now detects 47 of 47 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.27] - 2026-11-03

### Added

- Go fence function parameters infer their types from the signature, including grouped parameters such as `v, w *Viper`.
- Local Go fixture covers a typed-parameter method with a distinct mutation.

### Improved

- Go fixture grew from 18 to 20 bound anchors and from 15 to 16 detected mutations.
- Corpus now detects 45 of 45 seeded mutations with zero collateral findings.
- Viper anchors fell from 196 to 194 while keeping 94 bound symbols.

### Limits

- Go fence inference does not type externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.26] - 2026-11-03

### Added

- Go fence alias copies such as `w := v` inherit the current local type, so `w.Copied()` resolves through `Viper.Copied`.
- Local Go fixture covers an alias-copied method with a distinct mutation.

### Improved

- Go fixture grew from 17 to 18 bound anchors and from 14 to 15 detected mutations.
- Corpus now detects 44 of 44 seeded mutations with zero collateral findings.

### Limits

- Go fence inference does not type function parameters or externally supplied values.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.25] - 2026-11-03

### Added

- Go fence locals infer types from annotated declarations such as `var v *Viper` and from reassignments.
- Unknown reassignments clear the inferred type, preventing stale method binds.
- Go keyword tokens such as `var` are filtered from fence anchors.

### Improved

- Go fixture grew from 12 to 17 bound anchors and from 12 to 14 detected mutations.
- Corpus now detects 43 of 43 seeded mutations with zero collateral findings.
- Viper anchors fell from 267 to 196 through keyword and local-attribute filtering, while keeping 94 bound symbols.
- Branch coverage rose from 95.10% to 95.12%.

### Limits

- Go fence inference is assignment-local. Aliased or externally supplied locals are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.24] - 2026-11-03

### Added

- Go fence locals infer types from constructor calls and composite literals, so `v := viper.New()` resolves `v.Get()` to `Viper.Get`.
- Local Go fixture covers constructor-typed local method calls.

### Improved

- Go fixture grew from 10 to 12 bound anchors and from 10 to 12 detected mutations.
- Corpus now detects 41 of 41 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.06% to 95.10%.
- Untyped Go local attribute tokens are skipped, reducing viper's anchor count from 293 to 267 while keeping 94 bound symbols.

### Limits

- Go fence inference is assignment-local. Reassigned, aliased, or externally supplied locals are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.23] - 2026-11-03

### Added

- Go re-export cycles terminate with bounded passes and keep local symbols instead of creating false cross-package aliases.
- Local two-package cycle fixture covers value and type cycles.

### Improved

- Cycle fixture binds 2 of 2 anchors and detects 2 of 2 mutations.
- Corpus now detects 39 of 39 seeded mutations with zero collateral findings.

### Limits

- Go arbitrary arithmetic and composite expressions are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.22] - 2026-11-03

### Added

- Go instance-method wrappers infer the receiver parameter type and attach the wrapper selector to the target method.
- Local Go fixture covers `viper.WrapInstance` through `func WrapInstance(c *client.Client, value int) { return c.Instance(value) }`.

### Improved

- Go fixture grew from 9 to 10 bound anchors and from 9 to 10 detected mutations.
- Corpus now detects 37 of 37 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.05% to 95.06%.

### Limits

- Go arbitrary arithmetic, composite expressions, and re-export cycles are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.21] - 2026-11-03

### Added

- Go method-valued selectors such as `var MethodValue = client.Client.Computed` attach the re-export alias to the target method.
- Direct method-call wrappers such as `return client.Client.Wrapped(...)` attach the wrapper selector to the target method.
- Local Go fixture covers method-valued and computed aliases with separate mutation coverage.

### Improved

- Go fixture grew from 7 to 9 bound anchors and from 7 to 9 detected mutations.
- Corpus now detects 36 of 36 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.02% to 95.05%.

### Limits

- Go arbitrary arithmetic and composite expressions, instance-method wrappers, and re-export cycles are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.20] - 2026-11-03

### Added

- Go re-export aliases propagate through multiple package hops for type aliases, values, constants, and wrapper functions.
- Local Go fixture covers a chained `viper.AppClient.Special()` selector.

### Improved

- Go fixture grew from 6 to 7 bound anchors and from 6 to 7 detected mutations.
- Corpus now detects 34 of 34 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.01% to 95.02%.

### Limits

- Go computed re-exports, method-valued wrappers, and re-export cycles are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.19] - 2026-11-03

### Added

- Go wrapper functions that only return a call to another package attach the wrapper selector to the target function.
- Local Go fixture covers `viper.Wrap(1)` through `func Wrap(...) { return client.Target(...) }`.

### Improved

- Go fixture grew from 5 to 6 bound anchors and from 5 to 6 detected mutations.
- Corpus now detects 33 of 33 seeded mutations with zero collateral findings.
- Branch coverage rose from 95.00% to 95.01%.

### Limits

- Go multi-step re-export chains are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.18] - 2026-11-03

### Added

- Go variable and constant re-exports follow simple selectors such as `var ErrX = client.ErrX` and `const Limit = client.Limit`.
- Re-export aliases attach to the target symbol and the duplicate local symbol is removed.

### Improved

- Go fixture grew from 3 to 5 bound anchors and from 3 to 5 detected mutations.
- Corpus now detects 32 of 32 seeded mutations with zero collateral findings.

### Limits

- Go wrapper-function and multi-step re-export chains are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.17] - 2026-11-03

### Added

- Go type aliases resolve cross-package re-exports, exposing target methods under the re-exporting package selector.
- Local Go fixture covers `viper.Client.Perform()` through `type Client = client.Client`.

### Fixed

- Go methods attach to types in their own package directory, so same-named types in different packages no longer collide.

### Improved

- Go fixture grew from 2 to 3 bound anchors and from 2 to 3 detected mutations.
- Corpus now detects 30 of 30 seeded mutations with zero collateral findings.

### Limits

- Go re-exports are followed through type aliases. Variable, constant, and wrapper-function re-exports are not followed.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.16] - 2026-11-03

### Added

- Unique bare exported Go identifiers receive package-export evidence, resolving names such as `SetDefault`, `GetInt`, `Unmarshal`, and `FlagValue` even when a method shares the name.

### Fixed

- Corpus harness refreshes lock entries on every run, so stale bindings cannot inflate counts.

### Improved

- viper corpus bind rate rose from 66 to 94 anchors. Mutation coverage rose from 5 to 8.
- Corpus now detects 29 of 29 seeded mutations with zero collateral findings.

### Limits

- Go package aliases do not model re-exports through a separate package.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.15] - 2026-11-03

### Added

- Go symbols carry aliases from the declared package clause, not only the file-based module path.
- Local Go corpus fixture covers a package selector and a constant.

### Improved

- viper corpus bind rate rose from 53 to 66 anchors. Mutation coverage rose from 3 to 5.
- Corpus now detects 26 of 26 seeded mutations with zero collateral findings.

### Limits

- Go package aliases do not model re-exports through a separate package.
- General proc-macro bodies and npm publication remain unresolved.

## [0.1.14] - 2026-11-03

### Added

- Exported Rust `macro_rules!` definitions are emitted as symbols with `name!` aliases.
- Generic type tokens such as `anyhow::Result<T>` normalize to their base type for lookup.
- Macro invocations and bare type aliases earn dedicated binding evidence.

### Improved

- anyhow corpus bind rate rose from 5 to 10 anchors. Mutation coverage rose from 2 to 3.
- Corpus now detects 22 of 22 seeded mutations with zero collateral findings.

### Limits

- Crate-wide macro collection is name-based. Same-name non-exported macros in different modules let the last definition win.
- General proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.13] - 2026-11-03

### Added

- Rust `macro_rules!` supports optional `?` repetition in matchers and transcribers, including absent captures.
- Macro corpus fixture covers optional argument and return captures.

### Improved

- Macro fixture bind rate rose from 9 to 11 anchors. Seeded mutations rose from 7 to 9, all detected.
- Corpus now detects 21 of 21 seeded mutations with zero collateral findings.

### Limits

- Crate-wide macro collection is name-based. Same-name non-exported macros in different modules let the last definition win.
- General proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.12] - 2026-11-03

### Added

- Non-exported `macro_rules!` definitions are collected per package and resolve across sibling modules.
- Macro corpus fixture now invokes a plain sibling-module macro under `#[macro_use]`.

### Improved

- Macro fixture bind rate rose from 8 to 9 anchors. Seeded mutations rose from 5 to 7, all detected.
- Corpus now detects 19 of 19 seeded mutations with zero collateral findings.

### Limits

- Crate-wide macro collection is name-based. Same-name non-exported macros in different modules let the last definition win.
- `?` repetition and general proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.11] - 2026-11-03

### Added

- Nested Rust `macro_rules!` repetition preserves independent capture trees, so each outer group keeps its own inner lists.
- Separate top-level repetition lists in one matcher are bounded by the following literal.
- Shorter module aliases such as `alpha.two` for generated nested-module functions.
- Macro corpus fixture now covers grouped modules with different inner list lengths.

### Improved

- Macro fixture bind rate rose from 5 to 8 anchors. Seeded mutations rose from 3 to 5, all detected.
- Corpus now detects 17 of 17 seeded mutations with zero collateral findings.

### Limits

- `?` repetition, non-exported cross-file macros, and general proc-macro bodies remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.10] - 2026-11-03

### Added

- Python local type inference in fenced examples. Constructor assignments, annotations, `with ... as` blocks, and source return annotations resolve instance calls such as `response.json()`.
- `pycon` fence support for Python REPL examples.
- Python dotted fence chains stay whole, so `httpx.get` and `Client.get` remain qualified.

### Fixed

- Corpus mutation attribution now relates class-member findings to the mutated class.

### Improved

- httpx corpus bind rate rose from 65 to 379 anchors with zero baseline and zero doc-edit findings.

### Limits

- Python inference is assignment-local and return-type based. It does not perform control-flow analysis.
- Nested repetition with independent capture trees and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.9] - 2026-11-03

### Added

- Python package-qualified aliases such as `httpx.Client` and `httpx.Response.json`.
- Python class-qualified method and attribute binding for names such as `Response.json()` and `Response.status_code`.

### Fixed

- Class-qualified references ending in a file-like suffix, such as `Response.json()`, are no longer vetoed as file paths.
- httpx corpus bind rate rose from 34 to 65 anchors with zero baseline findings.

### Limits

- Instance-qualified Python references such as `response.json()` still need local type inference.
- Nested repetition with independent capture trees and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.8] - 2026-11-03

### Added

- Nested Rust `macro_rules!` repetition for patterns that share a metavariable across levels.
- Macro corpus fixture now includes a cross-file nested repetition invocation.
- Nested-generated symbol mutation is detected.

### Limits

- Nested repetition with independent capture trees is still not expanded.
- The unscoped npm package remains unavailable.

## [0.1.7] - 2026-11-03

### Added

- Rustdoc shape fidelity for structs, enums, traits, fields, variants, type aliases, and constants.
- Proc-macro fixture now generates both a function and a struct field that the rustdoc extractor discovers.

### Limits

- Rustdoc type rendering remains coarse for complex qualified, function-pointer, and associated types.
- Nested `macro_rules!` repetition and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.6] - 2026-11-03

### Added

- Opt-in rustdoc JSON extractor for proc-macro-generated public functions, impl methods, trait methods, and macro items.
- Local proc-macro workspace fixture that exercises the rustdoc extractor.
- Real thiserror corpus case now runs with rustdoc extraction enabled.

### Security

- Rustdoc extraction runs `cargo +nightly rustdoc`, which executes build scripts and proc macros. It is off by default and only enabled explicitly.

### Limits

- Nested `macro_rules!` repetition and non-exported cross-file macros remain unsupported.
- The unscoped npm package remains unavailable.

## [0.1.5] - 2026-11-03

### Added

- Standard Rust derive synthesis for `Clone`, `Default`, `Debug`, `PartialEq`, `PartialOrd`, `Ord`, and `Hash`.
- `#[proc_macro_derive(Name)]` recognition in Rust extractors.
- Real thiserror proc-macro corpus case.
- Derive attributes in fenced docs now provide structural binding evidence.

### Limits

- General proc-macro output, derive bodies, and nested repetition are not expanded.
- The unscoped npm package remains unavailable.

## [0.1.4] - 2026-11-03

### Added

- Rust `macro_rules!` repetition patterns with comma and semicolon separators, `*` and `+`.
- Cross-file `#[macro_export]` macro usage through `crate::name!` paths.
- Macro fixture now exercises cross-file repetition and two generated functions.

### Limits

- Nested repetition, non-exported cross-file macros, proc macros, and derive output are not expanded.

## [0.1.3] - 2026-11-03

### Added

- Narrow Rust `macro_rules!` expansion for same-file item generators using `ident`, `vis`, `tt`, and `ty` fragments.
- Local macro-heavy corpus fixture with generated public functions. Both mutations detected.

### Limits

- Macro expansion does not cover repetition, cross-file macro imports, proc macros, or derive output.

## [0.1.2] - 2026-11-03

### Added

- Pinned open-source corpus harness in `corpus/`. It measures baseline findings, doc-edit noise, bind rate, mutation recall, and collateral findings.
- Corpus report and methodology page.

### Fixed

- Duplicate JS and `.d.ts` declarations no longer produce false L3 findings.
- Python property getter and setter pairs no longer produce duplicate class members.
- Removing a type annotation from a documented symbol is now a breaking change instead of a silent pass.

### Improved

- Rust and Go fenced code keeps qualified chains such as `viper.SetConfigName` and `User::new` instead of splitting them into unrelated identifiers. The viper corpus bind rate rose from 0 to 53 anchors.
- Rust crate-name aliases such as `anyhow::Result`, plus `::` and `.` path normalization, raised the anyhow corpus bind rate from 0 to 4 anchors.

## [0.1.1] - 2026-11-03

### Added

- Rust and Go signature fences. Fenced declarations now compare against the real symbol shape.
- Signature pairing for Rust methods and Go receiver methods.
- Go type blocks with struct and interface declarations.
- Go interface embedding in shape comparison.
- Go receiver mutability in method shapes.
- TypeScript namespace re-exports such as `export * as api from "./mod"`.
- Rust cross-file and grouped `pub use` aliases.
- Go methods declared in a different file from their receiver type.
- Rust impl methods declared in a different file from their type.

### Changed

- Package name is now `@vindeckyy/docbind`. The unscoped `docbind` npm name belongs to an unrelated package.
- Source install and GitHub Action instructions no longer call the unscoped npm package.

## [0.1.0] - 2026-11-03

### Added

- TypeScript and JavaScript extraction through the TypeScript compiler API.
- Python extraction through a bundled `ast` worker.
- Rust extraction through a shared lexer and item parser.
- Go extraction through a shared lexer and declaration parser. Opt-in.
- Markdown anchors for inline code, headings, tables, fenced code, signature fences, and explicit references.
- Binding lock, three-way diff, tombstones, and rename and move inference.
- Contract shapes for parameters, return types, members, enums, receivers, async, unsafe, and deprecation.
- Compatibility lattice that keeps additive changes silent.
- CLI commands: `init`, `check`, `lock`, `fix`, `explain`, `stats`.
- SARIF, GitHub annotations, JSON output, and severity policy.
- Conservative fix engine for renames and moved paths.
- Changed-line coverage gate, structure gate, and 95% test coverage thresholds.
- MkDocs documentation site and GitHub Pages workflow.

### Security

- Extraction parses source. It does not build or execute project code.

[0.1.0]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.0
[0.1.1]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.1
[0.1.2]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.2
[0.1.3]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.3
[0.1.4]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.4
[0.1.5]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.5
[0.1.6]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.6
[0.1.7]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.7
[0.1.8]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.8
[0.1.9]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.9
[0.1.10]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.10
[0.1.11]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.11
[0.1.12]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.12
[0.1.13]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.13
[0.1.14]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.14
[0.1.15]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.15
[0.1.16]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.16
[0.1.17]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.17
[0.1.18]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.18
[0.1.19]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.19
[0.1.20]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.20
[0.1.21]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.21
[0.1.22]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.22
[0.1.23]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.23
[0.1.24]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.24
[0.1.25]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.25
[0.1.26]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.26
[0.1.27]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.27
[0.1.28]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.28
[0.1.29]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.29
[0.1.30]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.30
[0.1.31]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.31
[0.1.32]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.32
[0.1.33]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.33
[0.1.34]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.34
[0.1.35]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.35
[0.1.36]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.36
[0.1.37]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.37
[0.1.38]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.38
[0.1.39]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.39
[0.1.40]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.40
[0.1.41]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.41
[0.1.42]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.42
[0.1.43]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.43
[0.1.44]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.44
[0.1.45]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.45
[0.1.46]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.46
[0.1.47]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.47
[0.1.48]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.48
[0.1.49]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.49
[0.1.50]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.50
[0.1.51]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.51
[0.1.52]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.52
[0.1.53]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.53
[0.1.54]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.54
[0.1.55]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.55
[0.1.56]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.56
[0.1.57]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.57
[0.1.58]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.58
[0.1.59]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.59
[0.1.60]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.60
[0.1.61]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.61
[0.1.62]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.62
[0.1.63]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.63
[0.1.64]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.64
[0.1.65]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.65
[0.1.66]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.66
[0.1.67]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.67
[0.1.68]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.68
[0.1.69]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.69
[0.1.70]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.70
[0.1.71]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.71
[0.1.72]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.72
[0.1.73]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.73
[0.1.74]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.74
[0.1.75]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.75
[0.1.76]: https://github.com/vindeckyy/docbind/releases/tag/v0.1.76
