# Prior art

The audit claim that code-to-doc surface staleness is an open hole needs one correction. Research prototypes exist. The shipping gap is narrower than "nobody has tried this", and the tool should be honest about the difference.

## Directly related

Tan, Wagner, and Treude, "Detecting Outdated Code Element References in Software Repository Documentation" (arXiv:2212.01479, 2022). The paper analyzes more than 3,000 GitHub projects, reports that most contain at least one outdated code element reference at some point, and publishes an implementation that scans a repository for references whose source definitions were deleted.

What it establishes: the problem is real, common, and detectable with static analysis over backticked identifiers.

What docbind adds beyond that description:

- A checked-in binding with the contract shape the doc last asserted.
- Shape-level comparison, including parameters, return types, async, members, and enum variants.
- Rename and module-move inference with conservative fixes.
- Tombstones that survive lock generations, so deleted symbols stay distinguishable from prose.
- Three-way diff semantics, so unrelated doc edits do not clear a valid stale claim.
- CI-grade outputs: SARIF, GitHub annotations, stable fingerprints, and severity policy.

The paper's approach targets references that survive after all source definitions disappear. Existence is the signal. docbind treats existence as only one of four failure modes.

## Adjacent tools

| Category | Examples | Gap |
|---|---|---|
| Doc generators | TypeDoc, pydoc-markdown, rustdoc, mdBook | Generate from code; do not audit handwritten claims |
| Link checkers | lychee, markdown-link-check, Docusaurus broken links | Check URLs and paths, not symbols |
| Prose linters | Vale, textlint, alex | Check style and wording, not code bindings |
| Docstring linters | eslint-plugin-jsdoc, pydocstyle | Read comments next to code, not markdown |
| Snippet runners | pytest-codeblocks, doc-detective, mdBook test | Execute examples; do not compare symbol contracts |
| Rename tools | tsserver, gopls, rust-analyzer | Rename code; do not know which docs referenced the symbol |
| Code search | Sourcegraph | Finds references on demand; no per-commit baseline or shape diff |

Fraco (Ratol and Robillard, 2017) detects fragile source comments after identifier renames. It is close in spirit but targets comments, not markdown.

## Positioning

The audit's "open hole" framing is fair for shipped, maintained, multi-language tooling with CI integration. It is not fair if read as "no research exists". docbind competes on precision and workflow, not on being the first static analysis of the problem.

Release material should say:

> Research prototypes detect deleted references. docbind adds contract shapes, rename inference, a binding lock, and CI-grade precision for handwritten markdown.

Do not claim the problem was untouched.
