# Installation

## Zero-clone install

The repository is the distribution channel until the npm package is publishable:

```sh
npx --yes github:vindeckyy/docbind#v0.5.0 --version
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

The release workflow builds `docbind-<os>-<arch>` with Bun for Linux, macOS, and Windows, publishes `SHA256SUMS`, and emits GitHub build provenance attestations. `npm run binaries` builds the current platform into `dist/bin/`.

```sh
dist/bin/docbind-darwin-arm64 --version
sha256sum -c SHA256SUMS
gh attestation verify docbind-linux-x64 --repo vindeckyy/docbind
```

Pin the git install to a tag or commit (`github:vindeckyy/docbind#v0.5.0`). An unpinned GitHub URL is not a registry package and bypasses registry integrity controls.

The binary bundles TypeScript, Rust, Go, and Java extraction. Python extraction still needs `python/docbind_extract.py` beside the binary or `DOCBIND_PYTHON_WORKER` pointing at it, because the worker is a separate Python file. The binary does not replace the npm path for Python-only projects.
