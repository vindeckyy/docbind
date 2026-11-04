# Integrations

First-party snippets live in [`integrations/`](https://github.com/vindeckyy/docbind/tree/main/integrations).

## GitHub Actions

Use the composite action in [`action/`](https://github.com/vindeckyy/docbind/tree/main/action). It runs `docbind check --sarif docbind.sarif` and uploads the SARIF file.

## GitLab CI

```yaml
docbind:
  image: node:22-alpine
  script:
    - npx --yes github:vindeckyy/docbind check --sarif docbind.sarif
  artifacts:
    when: always
    paths:
      - docbind.sarif
```

## Jenkins

```groovy
pipeline {
  agent { docker { image 'node:22-alpine' } }
  stages {
    stage('docbind') {
      steps {
        sh 'npx --yes github:vindeckyy/docbind check --sarif docbind.sarif'
      }
      post {
        always {
          archiveArtifacts artifacts: 'docbind.sarif', allowEmptyArchive: true
        }
      }
    }
  }
}
```

## VS Code

The extension in [`integrations/vscode/`](https://github.com/vindeckyy/docbind/tree/main/integrations/vscode) runs `docbind check --json` on Markdown save, publishes diagnostics, and offers a quick fix that inserts an explicit annotation.

It requires Node 22.12+ on `PATH` and does not bundle the CLI.

## pre-commit and Docker

See [Installation](installation.md).
