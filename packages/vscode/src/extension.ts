import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { contextAt, completionsFor, hoverFor, lint } from "./language.js";

const HEADER = /^(loop|pipeline|flow)\b/;
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
    vscode.commands.registerCommand("loop.run", (uri?: vscode.Uri) => runLoop(uri, output)),
    vscode.commands.registerCommand("loop.runInSession", (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return void vscode.window.showErrorMessage("Loop: no .loop file to run.");
      runInSession(target);
    }),
    vscode.commands.registerCommand("loop.newFromTemplate", (uri?: vscode.Uri) => newFromTemplate(context, uri))
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

// The bundled best-practice library (synced from the repo's /templates at build).
// `deps` are the shared support files a multi-file flow needs alongside its entry.
interface Tmpl { file: string; label: string; blurb: string; deps?: string[] }
const TEMPLATES: Tmpl[] = [
  // Spec-driven — a whole app / a written backlog
  { file: "greenfield-app.loop", label: "greenfield-app", blurb: "Build an app A→Z: discover → design → per-story", deps: ["discover.loop", "design.loop", "story-template.loop", "sprint.yaml", "plan.md"] },
  { file: "load-spec.loop", label: "load-spec", blurb: "Deliver an existing backlog story by story", deps: ["story-template.loop", "sprint.yaml", "plan.md"] },
  // Change — build / fix / restructure
  { file: "feature.loop", label: "feature", blurb: "Ship one feature: build → regression → security → 👤 review" },
  { file: "brownfield-feature.loop", label: "brownfield-feature", blurb: "Add a feature to an existing codebase without breaking it" },
  { file: "bugfix.loop", label: "bugfix", blurb: "Fix one bug, proven by a named test" },
  { file: "refactor.loop", label: "refactor", blurb: "Improve structure, behavior unchanged" },
  // Quality gates — drive existing checks to green
  { file: "cicd-check.loop", label: "cicd-check", blurb: "Make every CI check pass locally" },
  { file: "security.loop", label: "security", blurb: "Security pass before shipping: sast → deps → 👤 secrets" },
  { file: "clean-architecture.loop", label: "clean-architecture", blurb: "Enforce architecture boundaries — deps point inward" },
  { file: "test-coverage.loop", label: "test-coverage", blurb: "Raise coverage to a threshold with real tests" },
  { file: "review-diff.loop", label: "review-diff", blurb: "Review + clean the current branch diff" },
];

async function newFromTemplate(context: vscode.ExtensionContext, folder?: vscode.Uri): Promise<void> {
  const fs = await import("node:fs/promises");
  const { join } = await import("node:path");
  const templatesDir = join(context.extensionPath, "templates");

  const pick = await vscode.window.showQuickPick(
    TEMPLATES.map((t) => ({ label: t.label, description: t.blurb, tmpl: t })),
    { placeHolder: "Choose a Loop template" }
  );
  if (!pick) return;

  // Right-clicked an Explorer folder → drop it there, no prompt. Otherwise ask,
  // relative to the workspace root.
  let destDir: string;
  if (folder) {
    destDir = folder.fsPath;
  } else {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showErrorMessage("Loop: open a folder first."); return; }
    const sub = await vscode.window.showInputBox({
      prompt: "Copy into which folder (relative to the workspace)?",
      value: ".",
    });
    if (sub === undefined) return;
    destDir = join(ws.uri.fsPath, sub);
  }
  await fs.mkdir(destDir, { recursive: true });
  const where = vscode.workspace.asRelativePath(destDir);

  const files = [pick.tmpl.file, ...(pick.tmpl.deps ?? [])];
  let copied = 0;
  let skipped = 0;
  for (const f of files) {
    const dest = join(destDir, f);
    let exists = false;
    try { await fs.access(dest); exists = true; } catch { /* missing → copy */ }
    if (exists) {
      const ans = await vscode.window.showWarningMessage(`${f} already exists in ${where}. Overwrite?`, "Overwrite", "Skip");
      if (ans !== "Overwrite") { skipped++; continue; }
    }
    try {
      await fs.copyFile(join(templatesDir, f), dest);
      copied++;
    } catch {
      vscode.window.showWarningMessage(`Loop: template file "${f}" is missing from the extension bundle.`);
    }
  }

  vscode.window.showInformationMessage(`Loop: copied ${copied} file(s) to ${where}${skipped ? `, skipped ${skipped}` : ""}. Edit the # TODO lines before running.`);

  // Open the entry .loop so the user lands on the thing to run.
  const doc = await vscode.workspace.openTextDocument(join(destDir, pick.tmpl.file));
  await vscode.window.showTextDocument(doc);
}

/** ▶ Run lens above every loop/pipeline definition. */
class RunCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      if (HEADER.test(line.text.trim()) && line.firstNonWhitespaceCharacterIndex === 0) {
        const range = new vscode.Range(i, 0, i, 0);
        lenses.push(
          new vscode.CodeLens(range, { title: "▶ Run", command: "loop.run", arguments: [document.uri] }),
          new vscode.CodeLens(range, { title: "$(comment-discussion) Claude session", command: "loop.runInSession", arguments: [document.uri] })
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
    return completionsFor(ctx).map((s, i) => {
      const isTemplate = s.kind === "template";
      const it = new vscode.CompletionItem(
        s.label,
        isTemplate ? vscode.CompletionItemKind.Snippet : vscode.CompletionItemKind.Keyword
      );
      it.insertText = new vscode.SnippetString(s.insert);
      it.detail = isTemplate ? `loop template · ${s.detail}` : `loop · ${s.detail}`;
      it.documentation = new vscode.MarkdownString(s.doc);
      // Rank templates first, then constructs; stable within each group by source order.
      it.sortText = `${isTemplate ? "0" : "1"}${String(i).padStart(3, "0")}`;
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
  if (!parserMod) parserMod = (await import("@loop-lang/parser")) as any;
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
    const cli = join(require.resolve("@loop-lang/runtime/package.json"), "..", "dist", "cli.js");
    if (existsSync(cli)) return cli;
  } catch {
    /* not resolvable */
  }
  const dev = join(__dirname, "..", "..", "runtime", "dist", "cli.js");
  return existsSync(dev) ? dev : null;
}

/** Render one runtime LoopEvent as a trace line (mirrors the CLI's glyphs). */
function renderEvent(e: any): string | null {
  switch (e?.type) {
    case "pipeline-start": return `▶ pipeline "${e.name}"`;
    case "stage-start": return `  ■ stage "${e.name}"`;
    case "stage-end": return `  ■ stage "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "resumed": return `  ⏩ ${e.unit} ${e.name ? `"${e.name}"` : ""}${e.index !== undefined ? ` #${e.index + 1}` : ""} — resumed`;
    case "loop-start": return `↻ loop ${e.name ? `"${e.name}"` : ""}`.trimEnd();
    case "node-enter": return `    · ${e.node} (try ${e.attempt})`;
    case "observe": return `    = ${e.passed ? "PASS" : "fail"}${e.output ? ` — ${String(e.output).split("\n")[0].slice(0, 80)}` : ""}`;
    case "transition": return `    → on ${e.on}: ${(e.actions || []).join(", ")}`;
    case "reflect": return `    ~ reflect${e.focus ? ` (${e.focus})` : ""}`;
    case "loop-back": return `    ↺ back to ${e.to}`;
    case "also": return `    + also: ${e.action} → ${e.ok ? "done" : "skipped"}`;
    case "human": return `    ? human ${e.kind}${e.answer ? `: ${e.answer}` : ""}`;
    case "stop": return `    ◼ stop (${e.reason})${e.warn ? ` — ⚠ ${e.warn}` : ""}`;
    case "loop-end": return `↻ done → ${e.satisfied ? "satisfied" : "not satisfied"}`;
    case "pipeline-end": return `▶ pipeline "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "flow-start": return `→ flow "${e.name}"`;
    case "flow-step-start": return `  ▸ ${e.name} (${e.ref})`;
    case "flow-step-end": return `  ▸ ${e.name} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "flow-end": return `→ flow "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "foreach-start": return `→ for each ${e.var} in ${e.source} (${e.count})`;
    case "foreach-item-start": return `  • ${e.var} ${e.index + 1}/${e.total}`;
    case "foreach-item-end": return `  • ${e.var} #${e.index + 1} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "foreach-end": return `→ for each ${e.var} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    default: return null;
  }
}

const HUMAN_PROMPT: Record<string, (p: string) => string> = {
  plan: (p) => `Approve the plan for: ${p}`,
  review: (p) => `The loop reports done for: ${p}\nApprove to finish?`,
  gate: (p) => `Gate: ${p}\nProceed?`,
  confirm: (p) => `Allow "${p}" actions this run?`,
  ask: (p) => `The loop is blocked on: ${p}\nResolve, then continue.`,
};

// ▶ Play dispatches by the `loop.runMode` setting: open a Claude Code session,
// or run headless in the output panel. "ask" prompts which one each time.
async function runLoop(uri: vscode.Uri | undefined, output: vscode.OutputChannel) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) return void vscode.window.showErrorMessage("Loop: no .loop file to run.");

  let mode = vscode.workspace.getConfiguration("loop").get<string>("runMode") || "ask";
  if (mode === "ask") {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(comment-discussion) Claude Code session", description: "open an interactive session — watch every step, answer gates in chat", mode: "session" },
        { label: "$(output) VS Code output panel", description: "run headless — stream the trace into the Output panel", mode: "output" },
      ],
      { placeHolder: `Run ${baseName(target.fsPath)} — where?` }
    );
    if (!pick) return; // cancelled
    mode = pick.mode;
  }

  if (mode === "session") return runInSession(target);
  return runInOutput(target, output);
}

// Open (or reuse) an integrated terminal and start a real Claude Code session that runs the loop.
function runInSession(target: vscode.Uri) {
  const cfg = vscode.workspace.getConfiguration("loop");
  const claude = cfg.get<string>("claudePath") || "claude";
  const model = cfg.get<string>("model");
  const cmd = `${claude}${model ? ` --model ${shq(model)}` : ""} ${shq(`/loopflow run ${target.fsPath}`)}`;
  const name = "Loop ▶ Claude";
  const term = vscode.window.terminals.find((t) => t.name === name) ?? vscode.window.createTerminal({ name, cwd: dirnameOf(target.fsPath) });
  term.show(true);
  term.sendText(cmd, true);
}

async function runInOutput(target: vscode.Uri, output: vscode.OutputChannel) {
  const cli = resolveCli();
  if (!cli) return void vscode.window.showErrorMessage("Loop: could not find the `loop` CLI. Set loop.cliPath in settings.");
  const model = vscode.workspace.getConfiguration("loop").get<string>("model");
  // `--events` streams NDJSON: live agent activity + human-gate requests we answer over stdin.
  const args = ["run", target.fsPath, "--events", ...(model ? ["--model", model] : [])];

  output.clear();
  output.show(true);
  output.appendLine(`▶ loop run ${target.fsPath}\n`);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Running loop…", cancellable: true },
    (_p, token) =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, [cli, ...args], { cwd: dirnameOf(target.fsPath) });
        token.onCancellationRequested(() => child.kill());

        let buf = "";
        let lastNode = "";
        const handle = (line: string) => {
          let m: any;
          try { m = JSON.parse(line); } catch { return; }
          if (m.kind === "event") {
            const text = renderEvent(m.event);
            if (text) output.appendLine(text);
          } else if (m.kind === "agent") {
            // live streaming of Claude's work, grouped under the current node
            if (m.node !== lastNode) { output.appendLine(`      ┌ ${m.node}`); lastNode = m.node; }
            for (const ln of String(m.text).split("\n")) output.appendLine(`      │ ${ln}`);
          } else if (m.kind === "ask") {
            // a human gate — pop a native dialog and answer over stdin
            const prompt = (HUMAN_PROMPT[m.human] ?? ((p: string) => p))(m.prompt);
            const yes = m.human === "ask" ? "Continue" : "Approve";
            const no = m.human === "ask" ? undefined : "Reject";
            const buttons = no ? [yes, no] : [yes];
            vscode.window.showInformationMessage(prompt, { modal: true }, ...buttons).then((choice) => {
              const approved = choice === yes;
              child.stdin.write(JSON.stringify({ id: m.id, approved }) + "\n");
            });
          } else if (m.kind === "end") {
            output.appendLine(`\n◼ ${m.ok ? "satisfied" : "finished (not satisfied)"}`);
          }
        };
        child.stdout.on("data", (d) => {
          buf += d.toString();
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            handle(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        });
        child.stderr.on("data", (d) => output.append(d.toString()));
        child.on("close", () => resolve());
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

function baseName(p: string): string {
  return p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
}

// Quote an argument for a POSIX shell (the common integrated-terminal case): double-quote and escape.
function shq(s: string): string {
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}
