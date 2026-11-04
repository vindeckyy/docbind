# Scope and limits

`docbind` detects **contract drift**, not documentation correctness. A green check means the symbol references still resolve to the shape recorded in the lock. It does not mean the prose is true.

## What a check proves

A passing check proves only this: every bound anchor still resolves, and the referenced contract shape did not change in a breaking way. Sentences can still be wrong, examples can still fail, and parameter descriptions can still mislead.

Do not treat `docbind` as a documentation linter. It does not read claims, evaluate examples, compare output, or judge whether an explanation matches runtime behavior.

## Explicit bindings are the sound mode

Inline annotations make binding exact:

```html
<!-- docbind: symbol=src/users.ts#getUser -->
```

The resolver matches the project-relative file and name directly. Confidence scores, veto rules, ambiguity checks, and prose context do not apply. If the symbol is missing or duplicated in that file, the check fails instead of guessing.

Once a repository contains at least one explicit annotation, findings from inferred anchors are downgraded to notes and do not fail the build. Explicit findings keep their configured severity. Repositories with no annotations keep the previous severity behavior.

Unannotated references still use heuristic binding. That path is useful for adoption, but it is not the sound mode. `docbind adopt` proposes annotations for existing inferred bindings, and `docbind audit --unbound` lists every token that stayed silent.

`docbind check --mode=strict` fails when abstentions fall on changed lines; `--mode=gate` keeps them as notes. Strict mode is the risk posture for teams that want abstentions to block a diff.

## Silence is deliberate, and it has a cost

Binding is conservative. Ambiguous names, uncertain imports, unusual doc formatting, and names that only look like code stay unbound. Unbound anchors produce no finding. That keeps false positives low, but it also means the gate misses drift the resolver could not bind.

The corpus publishes unbound counts next to bound counts. Those numbers are the honest measure of this gap:

- `minConfidence` is policy, not truth. Raising it reduces bindings; lowering it admits weaker evidence.
- Lowering the floor until CI passes is not a fix. Record why a threshold change is justified and review it like code.
- Ambiguity resolves to silence, not a guess. Two candidates scoring within `0.05` of each other produce no binding.
- A binding is evidence from a heuristic, not proof of intent.

## The lock is a second source of truth

`docbind.lock.json` records what the docs last asserted. That creates governance work:

- Refreshing the lock after changing code blesses the drift. Review the lock diff, not just the command.
- Reviewers who rubber-stamp lock churn turn the lock into noise.
- Lock merge conflicts need the same care as code conflicts.
- The schema is versioned, but stateful formats still carry long-term maintenance risk.

Use `docbind lock --check` in CI to fail when the lock is not derivable from the current docs. That makes the lock a cache of the docs, not authority over them. The command does not rewrite the lock.

`docbind lock --diff` renders the rebuild as semantic changes: added and removed anchors, symbol moves, and contract hashes. Review that instead of reading raw JSON lock churn.

A no-lock workflow is available: annotate with an inline `contract=` hash and run `docbind check --no-lock`. The doc and the contract then live in one file and the lock is not read. `docbind adopt --contract` writes those annotations. Commit lock changes in the same review as the doc change or the contract change that caused them.

## Heuristics are fragile

Binding prose to symbols depends on extraction and scoring. Known weak spots:

- re-exports, aliases, and generated declarations
- dynamic imports and runtime registration
- overloads, generics, decorators, and nested types
- monorepo package boundaries
- unusual doc formatting and prose that merely resembles code

Negative context cues such as "formerly" or "renamed" suppress findings. Those cues help precision, but ordinary prose can trigger them and hide real drift.

## Static analysis cannot see most doc rot

Not checked:

- wrong or stale examples
- incorrect expected output
- outdated behavior descriptions
- misleading parameter or return prose
- broken links, screenshots, and setup steps
- whether a sentence is true

Those are common documentation failures. `docbind` covers a narrower slice: symbol references and their recorded contract shapes.

## Language coverage is uneven

| Language | Status | Notes |
|---|---|---|
| TypeScript, JavaScript | default | TypeScript compiler API, syntactic |
| Python | default | bundled `ast` worker |
| Rust | default | built-in parser; macros handled heuristically |
| Rust rustdoc JSON | opt-in | runs `cargo +nightly rustdoc`, including build scripts |
| Go | opt-in | off by default because vendored generated packages are common |
| Java | opt-in | public/private members, Javadoc scanning, shape-only defaults |

Rustdoc JSON executes project build code. Enable it only on trusted repositories. Go is off by default for the same practical reason it is often noisy: generated and vendored trees.

## Distribution and maturity

The unscoped `docbind` npm name belongs to an unrelated package. The scoped package is not published. Until that changes, install from GitHub:

```sh
npx --yes github:vindeckyy/docbind --version
npx --yes github:vindeckyy/docbind check
```

This is a single-maintainer project. Treat production adoption as a maintenance and governance decision, not only a technical one.

## Evidence boundaries

The corpus is pinned and reproducible, but it is self-selected. Precision and mutation-recall numbers come from that corpus:

- mutation recall only measures symbols the lock already bound
- the threshold sweep covers a fixed set of local fixtures
- high test coverage measures this implementation, not external validity
- there is no independent evaluation on repositories the maintainers did not choose

Read [Corpus](corpus.md) and [Precision evidence](precision.md) for the raw numbers and caveats.

## When not to use it

Skip `docbind` when:

- API docs are generated from source, so references cannot drift independently
- a link checker plus type checking already covers the references you care about
- the docs are mostly tutorial prose and executable examples
- adding a lock file and a CI dependency costs more than the drift it prevents

It is most useful for repositories with hand-written API references that name real symbols and already review docs as code.
