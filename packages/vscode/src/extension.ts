import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { contextAt, completionsFor, hoverFor, lint } from "./language.js";

const HEADER = /^(loop|pipeline)\b/;
const LOOP_SELECTOR: vscode.DocumentSelector = { language: "loop" };

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Loop");
  const diagnostics = vscode.languages.createDiagnosticCollection("loop");

  context.subscriptions.push(
    output,
    diagnostics,
    vscode.languages.registerCodeLensProvider(LOOP_SELECTOR, new RunCodeLensProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(LOOP_SELECTOR, new LoopFormatter()),
    // Ctrl+Space (and as-you-type) autocomplete — context-aware, deterministic.
    vscode.languages.registerCompletionItemProvider(LOOP_SELECTOR, new LoopCompletion()),
    vscode.languages.registerHoverProvider(LOOP_SELECTOR, new LoopHover()),
    vscode.commands.registerCommand("loop.run", (uri?: vscode.Uri) => runLoop(uri, output))
  );

  // Live parse diagnostics (red squiggles) — debounced.
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "loop") return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => void refreshDiagnostics(doc, diagnostics), 300));
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri))
  );
  vscode.workspace.textDocuments.forEach(schedule);
}

export function deactivate() {}

/** ▶ Run lens above every loop/pipeline definition. */
class RunCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      if (HEADER.test(line.text.trim()) && line.firstNonWhitespaceCharacterIndex === 0) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(i, 0, i, 0), { title: "▶ Run loop", command: "loop.run", arguments: [document.uri] })
        );
      }
    }
    return lenses;
  }
}

/** Conservative formatter: strip trailing whitespace, tabs→2 spaces, collapse blank runs. */
class LoopFormatter implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    const out: string[] = [];
    let blanks = 0;
    for (const raw of document.getText().split(/\r?\n/)) {
      const line = raw.replace(/\t/g, "  ").replace(/[ \t]+$/g, "");
      if (line.trim() === "") {
        if (++blanks > 1) continue;
        out.push("");
      } else {
        blanks = 0;
        out.push(line);
      }
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    const full = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    return [vscode.TextEdit.replace(full, out.join("\n") + "\n")];
  }
}

/** Context-aware completion: suggests only what's valid where the cursor is. */
class LoopCompletion implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const lines = document.getText().split(/\r?\n/);
    const ctx = contextAt(lines, position.line);
    return completionsFor(ctx).map((s) => {
      const it = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Keyword);
      it.insertText = new vscode.SnippetString(s.insert);
      it.detail = `loop · ${s.detail}`;
      it.documentation = new vscode.MarkdownString(s.doc);
      return it;
    });
  }
}

/** Hover docs for the vocabulary. */
class LoopHover implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const range = document.getWordRangeAtPosition(position, /[a-zA-Z]+/);
    if (!range) return;
    const md = hoverFor(document.getText(range));
    return md ? new vscode.Hover(new vscode.MarkdownString(md)) : undefined;
  }
}

// ---- diagnostics via the (ESM) parser, dynamically imported from this CJS host ----

// Typed as any: a `typeof import(...)` annotation would resolve the ESM module's
// type into this CJS host and trip TS's ESM-in-CJS check. The runtime `await import()`
// is a real native dynamic import and works fine.
let parserMod: { parse: (s: string) => unknown; ParseError: new (...a: any[]) => Error } | undefined;
async function loadParser() {
  if (!parserMod) parserMod = (await import("@loop/parser")) as any;
  return parserMod!;
}

async function refreshDiagnostics(doc: vscode.TextDocument, collection: vscode.DiagnosticCollection) {
  try {
    const { parse, ParseError } = await loadParser();
    try {
      const spec = parse(doc.getText());
      // Parsed cleanly — surface soft structural nudges as warnings.
      const lines = doc.getText().split(/\r?\n/);
      const warnings = lint(spec as { definitions: unknown[] } as any, lines).map((w) => {
        const lineNo = Math.min(Math.max(0, w.line), doc.lineCount - 1);
        const d = new vscode.Diagnostic(doc.lineAt(lineNo).range, w.message, vscode.DiagnosticSeverity.Warning);
        d.source = "loop";
        return d;
      });
      collection.set(doc.uri, warnings);
    } catch (err) {
      if (err instanceof ParseError) {
        const lineNo = Math.min(Math.max(0, ((err as { line?: number }).line ?? 1) - 1), doc.lineCount - 1);
        const range = doc.lineAt(lineNo).range;
        const d = new vscode.Diagnostic(range, err.message.replace(/^Loop parse error \(line \d+\): /, ""), vscode.DiagnosticSeverity.Error);
        d.source = "loop";
        collection.set(doc.uri, [d]);
      } else {
        collection.set(doc.uri, []);
      }
    }
  } catch {
    // parser module unavailable (e.g. not installed alongside) — skip diagnostics silently
  }
}

// ---- ▶ Run: shell the loop CLI, stream into the output channel ----

function resolveCli(): string | null {
  const configured = vscode.workspace.getConfiguration("loop").get<string>("cliPath");
  if (configured && existsSync(configured)) return configured;
  try {
    const require = createRequire(join(__dirname, "package.json"));
    const cli = join(require.resolve("@loop/runtime/package.json"), "..", "dist", "cli.js");
    if (existsSync(cli)) return cli;
  } catch {
    /* not resolvable */
  }
  const dev = join(__dirname, "..", "..", "runtime", "dist", "cli.js");
  return existsSync(dev) ? dev : null;
}

async function runLoop(uri: vscode.Uri | undefined, output: vscode.OutputChannel) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) return void vscode.window.showErrorMessage("Loop: no .loop file to run.");
  const cli = resolveCli();
  if (!cli) return void vscode.window.showErrorMessage("Loop: could not find the `loop` CLI. Set loop.cliPath in settings.");
  const model = vscode.workspace.getConfiguration("loop").get<string>("model");
  const args = ["run", target.fsPath, ...(model ? ["--model", model] : [])];

  output.clear();
  output.show(true);
  output.appendLine(`▶ loop run ${target.fsPath}\n`);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Running loop…", cancellable: true },
    (_p, token) =>
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
