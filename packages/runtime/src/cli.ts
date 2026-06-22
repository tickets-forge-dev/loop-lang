#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { createInterface } from "node:readline";
import { parse } from "@loop-lang/parser";
import { resolvePreset } from "@loop-lang/stdlib";
import { run } from "./engine.js";
import { ShellVerifier } from "./verify.js";
import { CliHumanIO } from "./human.js";
import { ClaudeCodeRunner } from "./runners/claudeCode.js";
import { IpcHumanIO } from "./ipc.js";
import { ShellGitIO } from "./runners/shellGit.js";
import type { LoopEvent } from "./types.js";
import { summarizeModels, formatModelSummary } from "./summary.js";

const GLYPH: Partial<Record<LoopEvent["type"], string>> = {
  "pipeline-start": "▶ pipeline",
  "stage-start": "■ stage",
  "loop-start": "↻ loop",
  "node-enter": "  ·",
  observe: "  =",
  transition: "  →",
  reflect: "  ~",
  "loop-back": "  ↺",
  human: "  ?",
  stop: "  ◼",
};

function render(e: LoopEvent): string {
  switch (e.type) {
    case "pipeline-start":
      return `▶ pipeline "${e.name}"`;
    case "stage-start":
      return `  ■ stage "${e.name}"`;
    case "stage-end":
      return `  ■ stage "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "loop-start":
      return `↻ loop ${e.name ? `"${e.name}"` : ""}`.trimEnd();
    case "node-enter":
      return `    · ${e.node} (try ${e.attempt})`;
    case "observe":
      return `    = ${e.passed ? "PASS" : "fail"}${e.output ? ` — ${e.output.split("\n")[0].slice(0, 80)}` : ""}`;
    case "transition":
      return `    → on ${e.on}: ${e.actions.join(", ")}`;
    case "reflect":
      return `    ~ reflect${e.focus ? ` (${e.focus})` : ""}: ${e.text.split("\n")[0].slice(0, 90)}`;
    case "loop-back":
      return `    ↺ back to ${e.to}`;
    case "also":
      return `    + also: ${e.action} → ${e.ok ? "done" : "skipped"}`;
    case "human":
      return `    ? human ${e.kind}: ${e.prompt}`;
    case "stop":
      return `    ◼ stop (${e.reason})${e.warn ? ` — ⚠ ${e.warn}` : ""}`;
    case "loop-end":
      return `↻ done → ${e.satisfied ? "satisfied" : "not satisfied"}`;
    case "pipeline-end":
      return `▶ pipeline "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "flow-start":
      return `→ flow "${e.name}"`;
    case "flow-step-start":
      return `  ▸ ${e.name} (${e.ref})`;
    case "flow-step-end":
      return `  ▸ ${e.name} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "flow-end":
      return `→ flow "${e.name}" → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "foreach-start":
      return `→ for each ${e.var} in ${e.source} (${e.count})`;
    case "foreach-item-start":
      return `  • ${e.var} ${e.index + 1}/${e.total}`;
    case "foreach-item-end":
      return `  • ${e.var} #${e.index + 1} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "foreach-end":
      return `→ for each ${e.var} → ${e.satisfied ? "satisfied" : "FAILED"}`;
    case "git":
      return `  ⎇ git ${e.action}: ${e.detail}`;
    default:
      return "";
  }
}

/** Walk a dir for *.loop files, skipping noise. */
function findLoops(dir: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 6) return acc;
  let ents: import("node:fs").Dirent[];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
    const full = resolve(dir, e.name);
    if (e.isDirectory()) findLoops(full, acc, depth + 1);
    else if (e.name.endsWith(".loop")) acc.push(full);
  }
  return acc;
}

async function main() {
  const [cmd, fileArg, ...rest] = process.argv.slice(2);

  // `loop show <file>` — print the ASCII flow of a loop.
  if (cmd === "show") {
    if (!fileArg) { console.error("usage: loop-run show <file.loop>"); process.exit(2); }
    const { renderFile } = await import("./show.js");
    console.log(renderFile(parse(readFileSync(resolve(process.cwd(), fileArg), "utf8"))));
    return;
  }
  // `loop ls` — list every .loop under the current dir with its one-line shape.
  if (cmd === "ls") {
    const { oneLine } = await import("./show.js");
    const root = fileArg ? resolve(process.cwd(), fileArg) : process.cwd();
    const files = findLoops(root).sort();
    if (files.length === 0) { console.error("no .loop files found here."); return; }
    for (const f of files) {
      const rel = relative(process.cwd(), f) || f;
      try {
        const defs = parse(readFileSync(f, "utf8")).definitions;
        const shape = defs.length ? defs.map(oneLine).join(" ; ") : "(config only)";
        console.log(`${rel}\n   ${shape}`);
      } catch (err) {
        console.log(`${rel}\n   ⚠ parse error: ${String((err as Error)?.message ?? err)}`);
      }
    }
    return;
  }

  if (!cmd || (cmd !== "run" && cmd !== "parse" && cmd !== "viz") || !fileArg) {
    console.error("usage: loop-run <run|parse|viz|show|ls> <file.loop>  [--model <alias>] [--out <path>]");
    process.exit(2);
  }

  const path = resolve(process.cwd(), fileArg);
  const baseDir = dirname(path);
  const loadFile = (ref: string, dir: string) =>
    Promise.resolve(parse(readFileSync(resolve(dir, ref), "utf8")));
  const readText = (ref: string, dir: string) =>
    Promise.resolve(readFileSync(resolve(dir, ref), "utf8"));
  const src = readFileSync(path, "utf8");
  let file = parse(src);

  // If the file is a config that selects a preset, resolve and run the preset.
  if (file.definitions.length === 0 && file.config?.use) {
    const { source } = resolvePreset(file.config.use, baseDir);
    const preset = parse(source);
    file = { ...preset, config: file.config };
  }

  if (cmd === "parse" || rest.includes("--json")) {
    console.log(JSON.stringify(file, null, 2));
    if (cmd === "parse") return;
  }

  // Visualize: write a self-contained HTML schematic of the flow.
  if (cmd === "viz") {
    const { renderHtml } = await import("@loop-lang/viz");
    const html = renderHtml(file, { title: fileArg.split("/").pop() });
    const vOutIdx = rest.indexOf("--out");
    const dest = resolve(process.cwd(), vOutIdx >= 0 ? rest[vOutIdx + 1] : fileArg.replace(/\.loop$/, "") + ".html");
    writeFileSync(dest, html);
    console.error(`wrote ${dest}`);
    return;
  }

  const modelIdx = rest.indexOf("--model");
  const model = modelIdx >= 0 ? rest[modelIdx + 1] : undefined;
  const target = file.config?.target ? resolve(baseDir, file.config.target) : baseDir;

  const git = new ShellGitIO();

  // `--events`: machine-readable NDJSON protocol for a UI host (e.g. the VSCode
  // extension) — streams Claude's live activity and answers human gates over stdin.
  if (rest.includes("--events")) {
    const emit = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
    const ipc = new IpcHumanIO((req) => emit(req));
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      try {
        const m = JSON.parse(line);
        if (typeof m.id === "number") ipc.resolve(m.id, !!m.approved);
      } catch {
        /* ignore malformed input */
      }
    });
    const outcomes = await run(file, {
      runner: new ClaudeCodeRunner({ onActivity: (node, text) => emit({ kind: "agent", node, text }) }),
      verifier: new ShellVerifier(),
      human: ipc,
      git,
      baseDir: target,
      loadFile,
      readText,
      flowStack: [path],
      modelPolicy: file.config?.models,
      cliModel: model,
      onEvent: (e) => emit({ kind: "event", event: e }),
    });
    const ok = outcomes.every((o) => o.satisfied);
    emit({ kind: "end", ok });
    rl.close();
    process.exit(ok ? 0 : 1);
  }

  const traceEvents: LoopEvent[] = [];
  const outcomes = await run(file, {
    runner: new ClaudeCodeRunner({}),
    verifier: new ShellVerifier(),
    human: new CliHumanIO(),
    git,
    baseDir: target,
    loadFile,
    readText,
    flowStack: [path],
    modelPolicy: file.config?.models,
    cliModel: model,
    onEvent: (e) => {
      traceEvents.push(e);
      const line = render(e);
      if (line) console.log(line);
    },
  });

  const summary = formatModelSummary(summarizeModels(traceEvents));
  if (summary) console.error(summary);

  const ok = outcomes.every((o) => o.satisfied);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
