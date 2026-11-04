# docbind VS Code extension

Minimal editor surface for docbind:

- runs `docbind check --json` on Markdown save and on the `docbind: Check workspace` command
- publishes findings as diagnostics
- offers a quick fix that inserts `<!-- docbind: symbol=path#Name -->` above the finding

It shells out to `npx --yes github:vindeckyy/docbind`, so Node 22.12 or newer must be on `PATH`. The extension does not bundle the CLI. Package and install with your usual VS Code extension tooling.

Limits: findings are refreshed only on Markdown save or manual command, not as you type. The quick fix adds an annotation from the finding's code location; review the inserted path before committing.
