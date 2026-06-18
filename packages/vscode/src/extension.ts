import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const HEADER = /^(loop|pipeline)\b/;

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Loop");

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "loop" }, new RunCodeLensProvider()),
    vscode.languages.registerDocumentFormattingEditProvider({ language: "loop" }, new LoopFormatter()),
    vscode.languages.registerCompletionItemProvider({ language: "loop" }, new LoopCompletion()),
    vscode.commands.registerCommand("loop.run", (uri?: vscode.Uri) => runLoop(uri, output)),
    output
  );
}

export function deactivate() {}

/** ▶ Run lens above every loop/pipeline definition. */
class RunCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      if (HEADER.test(text.trim()) && document.lineAt(i).firstNonWhitespaceCharacterIndex === 0) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
            title: "▶ Run loop",
            command: "loop.run",
            arguments: [document.uri],
          })
        );
      }
    }
    return lenses;
  }
}

/** Conservative formatter: strip trailing whitespace, tabs→2 spaces, collapse blank runs. */
class LoopFormatter implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    const lines = document.getText().split(/\r?\n/);
    const out: string[] = [];
    let blanks = 0;
    for (const raw of lines) {
      const line = raw.replace(/\t/g, "  ").replace(/[ \t]+$/g, "");
      if (line.trim() === "") {
        blanks++;
        if (blanks > 1) continue;
        out.push("");
      } else {
        blanks = 0;
        out.push(line);
      }
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    const formatted = out.join("\n") + "\n";
    const full = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    return [vscode.TextEdit.replace(full, formatted)];
  }
}

const SNIPPETS: Array<[string, string, string]> = [
  ["loop", 'loop "${1:name}":\n  goal: ${2:what done means}\n  done when ${3:the test "x" passes}\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n', "A self-correcting loop"],
  ["pipeline", 'pipeline "${1:name}":\n  stage ${2:one}:\n    goal: ${3:...}\n    each cycle: plan, then act, then observe\n', "A staged pipeline"],
  ["stage", "stage ${1:name}:\n  goal: ${2:...}\n  each cycle: plan, then act, then observe\n", "A pipeline stage"],
  ["goal", "goal: ${1:...}", "The objective"],
  ["done when", 'done when the test "${1:file::name}" passes', "Verification predicate"],
  ["look at", "look at: ${1:fileA, fileB}, and the last failure", "Context the agent may read"],
  ["each cycle", "each cycle: plan, then act, then observe", "The repeated steps"],
  ["when it fails", "when it fails: reflect, then plan again", "Back-edge on failure"],
  ["after tries", 'after ${1:6} tries: stop and warn "${2:thrashing}"', "Thrash guard"],
  ["a human approves the plan first", "a human approves the plan first", "Human plan gate"],
  ["a human reviews before stopping", "a human reviews before stopping", "Human review gate"],
  ["plan from archon", 'plan from the archon project "${1:project}"', "Source the plan from Archon"],
];

class LoopCompletion implements vscode.CompletionItemProvider {
  provideCompletionItems(): vscode.CompletionItem[] {
    return SNIPPETS.map(([label, body, doc]) => {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString(body);
      item.documentation = new vscode.MarkdownString(doc);
      return item;
    });
  }
}

function resolveCli(): string | null {
  const configured = vscode.workspace.getConfiguration("loop").get<string>("cliPath");
  if (configured && existsSync(configured)) return configured;
  // Try the installed @loop/runtime package.
  try {
    const require = createRequire(join(__dirname, "package.json"));
    const pkg = require.resolve("@loop/runtime/package.json");
    const cli = join(pkg, "..", "dist", "cli.js");
    if (existsSync(cli)) return cli;
  } catch {
    /* not installed alongside */
  }
  // Monorepo dev fallback.
  const dev = join(__dirname, "..", "..", "runtime", "dist", "cli.js");
  return existsSync(dev) ? dev : null;
}

async function runLoop(uri: vscode.Uri | undefined, output: vscode.OutputChannel) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showErrorMessage("Loop: no .loop file to run.");
    return;
  }
  const cli = resolveCli();
  if (!cli) {
    vscode.window.showErrorMessage("Loop: could not find the `loop` CLI. Set loop.cliPath in settings.");
    return;
  }
  const model = vscode.workspace.getConfiguration("loop").get<string>("model");
  const args = ["run", target.fsPath, ...(model ? ["--model", model] : [])];

  output.clear();
  output.show(true);
  output.appendLine(`▶ loop run ${target.fsPath}\n`);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Running loop…", cancellable: true },
    (_progress, token) =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, [cli, ...args], { cwd: dirnameOf(target.fsPath) });
        token.onCancellationRequested(() => child.kill());
        child.stdout.on("data", (d) => output.append(d.toString()));
        child.stderr.on("data", (d) => output.append(d.toString()));
        child.on("close", (code) => {
          output.appendLine(`\n◼ exited ${code}`);
          resolve();
        });
        child.on("error", (err) => {
          output.appendLine(`\n✖ ${err.message}`);
          resolve();
        });
      })
  );
}

function dirnameOf(p: string): string {
  return p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
}
