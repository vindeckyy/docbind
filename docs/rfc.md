# RFC process

Changes that alter the soundness story go through a written RFC before implementation. This includes binding semantics, the lock format, severity defaults, and any feature that runs project code.

## When an RFC is required

- new rule or severity default
- lock schema or migration behavior
- resolver or scoring changes
- execution or sandboxing behavior
- new language extractor or index ingestion
- public benchmark methodology

Bug fixes, docs, tests, and internal refactors do not need one.

## Process

1. Copy [`docs/rfcs/0000-template.md`](rfcs/0000-template.md) to `docs/rfcs/NNNN-short-name.md`.
2. Open a pull request. The RFC is the discussion thread.
3. Keep it open for at least seven days for non-trivial changes.
4. A maintainer accepts or rejects it. Accepted RFCs merge before the implementation.
5. The implementation PR links the RFC.

With one maintainer, acceptance is a single-maintainer decision. That limit is published rather than hidden. A second maintainer is still wanted.

## Template

The template asks for the problem, the proposed behavior, alternatives, migration, evidence, and security impact. An RFC without a failure mode is incomplete.
