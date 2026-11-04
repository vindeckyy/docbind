const vscode = require("vscode");
const { execFile } = require("node:child_process");

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("docbind");

  const run = () => {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!folder) return;
    diagnostics.clear();
    execFile(
      "npx",
      ["--yes", "github:vindeckyy/docbind", "check", "--json"],
      { cwd: folder.uri.fsPath, timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (!stdout) return;
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          return;
        }
        const byFile = new Map();
        for (const finding of parsed.findings || []) {
          const absolute = vscode.Uri.joinPath(folder.uri, finding.doc.path);
          const key = absolute.toString();
          const range = new vscode.Range(
            Math.max(0, finding.doc.line - 1),
            Math.max(0, finding.doc.column - 1),
            Math.max(0, finding.doc.line - 1),
            Math.max(0, finding.doc.column - 1 + finding.doc.length)
          );
          const diagnostic = new vscode.Diagnostic(
            range,
            `${finding.rule}: ${finding.message}`,
            finding.severity === "error"
              ? vscode.DiagnosticSeverity.Error
              : finding.severity === "warning"
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information
          );
          diagnostic.source = "docbind";
          diagnostic.data = finding;
          const list = byFile.get(key) || [];
          list.push(diagnostic);
          byFile.set(key, list);
        }
        for (const [key, list] of byFile) {
          diagnostics.set(vscode.Uri.parse(key), list);
        }
      }
    );
  };

  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("docbind.check", run),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "markdown") run();
    }),
    vscode.languages.registerCodeActionsProvider(
      { language: "markdown" },
      {
        provideCodeActions(document, _range, context) {
          const actions = [];
          for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== "docbind" || !diagnostic.data || !diagnostic.data.code) continue;
            const anchor = diagnostic.data.code;
            const name = anchor.symbolId.split("|").filter(Boolean).pop() || "symbol";
            const annotation = `<!-- docbind: symbol=${anchor.path}#${name} -->`;
            const action = new vscode.CodeAction("Add docbind annotation", vscode.CodeActionKind.QuickFix);
            action.edit = new vscode.WorkspaceEdit();
            action.edit.insert(document.uri, new vscode.Position(Math.max(0, diagnostic.range.start.line), 0), `${annotation}\n`);
            actions.push(action);
          }
          return actions;
        }
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
