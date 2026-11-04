# Installation

## Zero-clone install

The repository is the distribution channel until the npm package is publishable:

```sh
npx --yes github:vindeckyy/docbind --version
npx --yes github:vindeckyy/docbind init
npx --yes github:vindeckyy/docbind check
```

Requires Node 22.12 or newer.

## Docker

```sh
docker build -t docbind .
docker run --rm -v "$PWD:/repo" docbind check
```

The image contains the built CLI, its runtime dependencies, and the Python extractor. It does not run project code unless you pass `--allow-exec` and enable `languages.rustdoc`.

## pre-commit

Add the hook to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/vindeckyy/docbind
    rev: v0.2.2
    hooks:
      - id: docbind
```

The hook runs `docbind check` once per commit and does not receive changed filenames.

## GitHub Actions

See [Usage](usage.md#ci) for the workflow form, SARIF upload, and exit codes.

## Binaries

Single-file binaries are not published yet. The npm and Docker paths above are the supported install routes.
