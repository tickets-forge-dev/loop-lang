#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative, basename } from "node:path";
import { createInterface } from "node:readline";
import { parse } from "@loop-lang/parser";
import type { Config, LoopFile } from "@loop-lang/parser";
import { resolvePreset } from "@loop-lang/stdlib";
import { run } from "./engine.js";
import { ShellVerifier } from "./verify.js";
import { CliHumanIO } from "./human.js";
import { ClaudeCodeRunner } from "./runners/claudeCode.js";
import { IpcHumanIO } from "./ipc.js";
import { ShellGitIO } from "./runners/shellGit.js";
import type { LoopEvent } from "./types.js";
import { summarizeModels, formatModelSummary, summarizeOpex, formatOpexSummary } from "./summary.js";

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
    case "memory-read":
      return `↻ memory: read ${e.file} (${e.bytes}b)`;
    case "memory-write":
      return `    ▎ memory: wrote ${e.file}`;
    case "skill-verify":
      return `    = skill "${e.skill}" → ${e.passed ? "APPROVED" : "rejected"}${e.detail ? ` — ${e.detail.split("\n").pop()!.slice(0, 80)}` : ""}`;
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
    case "ctx":
      return `    ⊕ ctx ${e.action}${e.ok === false ? " (skipped)" : ""}: ${e.skills.length ? e.skills.join(", ") : e.detail ?? "no change"}`;
    default:
      return "";
  }
}

/** Project-level config filenames, in priority order. Written in config-tier `.loop` syntax. */
const PROJECT_CONFIG_NAMES = ["loop.config", ".looprc"];

/**
 * Walk up from `startDir` looking for a project config file (`loop.config` / `.looprc`).
 * It is parsed with the same grammar as a `.loop` file but holds only a config tier
 * (e.g. `each cycle:`, `models:`, a `git:` block). Returns its config, or null.
 */
function findProjectConfig(startDir: string): { path: string; config: Config } | null {
  let dir = startDir;
  while (true) {
    for (const name of PROJECT_CONFIG_NAMES) {
      const p = resolve(dir, name);
      if (existsSync(p)) {
        try {
          const cfg = parse(readFileSync(p, "utf8")).config;
          if (cfg) return { path: p, config: cfg };
        } catch (err) {
          console.error(`⚠ ignoring ${p}: ${String((err as Error)?.message ?? err)}`);
        }
        return null; // a config file exists here but is empty/invalid — stop the search
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
}

/** File config wins over project defaults (lowest tier). Shallow per key — a `git:`/`models:` block in the file replaces the project's. */
function withProjectDefaults(fileConfig: Config | null, project: Config): Config {
  return { ...project, ...(fileConfig ?? {}) };
}

/** True when a file opts into ctx skill provisioning (config tier or any loop / pipeline stage). */
function fileUsesCtx(file: LoopFile): boolean {
  if (file.config?.skillSource?.provider === "ctx") return true;
  const usesCtx = (l: { skillDiscovery?: { provider?: string }; skillTopUp?: boolean }) =>
    l?.skillDiscovery?.provider === "ctx" || l?.skillTopUp === true;
  for (const def of file.definitions) {
    if (def.kind === "loop" && usesCtx(def)) return true;
    if (def.kind === "pipeline" && def.stages.some((s) => usesCtx(s.loop))) return true;
  }
  return false;
}

/**
 * Read and parse a `.loop` file, folding in any project-level `loop.config` as the lowest
 * cascade tier. `cycle` resolves at parse time (so it is passed in as `defaultCycle`); the
 * remaining config keys resolve at runtime and are merged onto the result.
 */
function loadLoopFile(absPath: string): LoopFile {
  const project = findProjectConfig(dirname(absPath));
  const file = parse(readFileSync(absPath, "utf8"), {
    defaultCycle: project?.config.cycle,
    defaultRigor: project?.config.rigor,
  });
  return project ? { ...file, config: withProjectDefaults(file.config, project.config) } : file;
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

/** Read all of stdin as a string (used by `emit` when the event isn't an arg). */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(""); return; }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

async function main() {
  const [cmd, fileArg, ...rest] = process.argv.slice(2);

  // `loop show <file>` — print the ASCII flow of a loop.
  if (cmd === "show") {
    if (!fileArg) { console.error("usage: loop-run show <file.loop>"); process.exit(2); }
    const { renderFile } = await import("./show.js");
    console.log(renderFile(loadLoopFile(resolve(process.cwd(), fileArg))));
    return;
  }
  // `loop explain <file>` — describe the loop in plain English (the friendly view).
  if (cmd === "explain") {
    if (!fileArg) { console.error("usage: loop-run explain <file.loop>"); process.exit(2); }
    const { explainFile } = await import("./show.js");
    console.log(explainFile(loadLoopFile(resolve(process.cwd(), fileArg))));
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

  // `loop-run emit <port> '<event-json>'` — push one LoopEvent to a running
  // `loop-run live` server so it broadcasts to the browser. Best-effort: never
  // throws (so the /loopflow skill's narration is never blocked by a push).
  if (cmd === "emit") {
    const port = fileArg;
    const json = rest.length ? rest.join(" ") : await readStdin();
    if (!port || !json) { console.error("usage: loop-run emit <port> '<event-json>'"); process.exit(2); }
    try {
      await fetch(`http://127.0.0.1:${port}/emit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
    } catch {
      /* server not up / closed — ignore so narration continues */
    }
    return;
  }

  if (!cmd || (cmd !== "run" && cmd !== "parse" && cmd !== "viz" && cmd !== "live") || !fileArg) {
    console.error("usage: loop-run <run|parse|viz|live|show|explain|ls|emit> <file.loop>  [--model <alias>] [--live] [--events] [--out <path>]");
    process.exit(2);
  }

  const path = resolve(process.cwd(), fileArg);
  const baseDir = dirname(path);
  const loadFile = (ref: string, dir: string) =>
    Promise.resolve(parse(readFileSync(resolve(dir, ref), "utf8")));
  const readText = (ref: string, dir: string) =>
    Promise.resolve(readFileSync(resolve(dir, ref), "utf8"));
  const writeText = (ref: string, content: string, dir: string) =>
    Promise.resolve(appendFileSync(resolve(dir, ref), content, "utf8"));
  let file = loadLoopFile(path);

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

  // `loop-run live <file>` — start the live dashboard server WITHOUT running the
  // engine, then stay up. The /loopflow skill runs the loop in-session and pushes
  // events with `loop-run emit <port> ...`; the browser renders them in real time.
  if (cmd === "live") {
    const { renderLiveHtml } = await import("@loop-lang/viz");
    const { startLiveServer } = await import("./serve.js");
    const html = renderLiveHtml(file, { title: basename(fileArg) });
    const noOpen = rest.includes("--no-open");
    const srv = await startLiveServer(html, { open: !noOpen });
    // Machine-readable line first so a driver can grep the port deterministically.
    console.log(`LOOP_LIVE_PORT=${srv.port}`);
    console.error(`\n  ↻ Loop live dashboard → http://127.0.0.1:${srv.port}`);
    console.error(`  push events: loop-run emit ${srv.port} '<event-json>'`);
    console.error(`  (Ctrl-C to stop)\n`);
    process.on("SIGINT", () => { srv.close(); process.exit(0); });
    process.on("SIGTERM", () => { srv.close(); process.exit(0); });
    return; // server keeps the event loop alive
  }

  // Visualize: write a self-contained HTML schematic of the flow.
  if (cmd === "viz") {
    const { renderHtml } = await import("@loop-lang/viz");
    const html = renderHtml(file, { title: basename(fileArg) });
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

  // Attach the ctx skill recommender only when the file opts in (`recommend skills with ctx`
  // or a `use skills recommended by ctx` loop). The dynamic import keeps the MCP SDK off the
  // path for every other run; a missing SDK / server degrades to a warning and no ctx.
  let ctx: import("./types.js").CtxAdapter | undefined;
  if (fileUsesCtx(file)) {
    try {
      const { McpCtxAdapter } = await import("./ctx.js");
      ctx = new McpCtxAdapter();
    } catch (err) {
      console.error(`⚠ ctx skill source requested but the MCP client could not load: ${String((err as Error)?.message ?? err)}`);
    }
  }

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
      ctx,
      baseDir: target,
      loadFile,
      readText,
      writeText,
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

  // Shared run wiring for the two terminal-trace paths (--live and default); they differ
  // only in whether events also stream to a live dashboard.
  const baseOpts = {
    runner: new ClaudeCodeRunner({}),
    verifier: new ShellVerifier(),
    human: new CliHumanIO(),
    git,
    ctx,
    baseDir: target,
    loadFile,
    readText,
    writeText,
    flowStack: [path],
    modelPolicy: file.config?.models,
    cliModel: model,
  };
  const traceEvents: LoopEvent[] = [];
  const onTrace = (e: LoopEvent) => {
    traceEvents.push(e);
    const line = render(e);
    if (line) console.log(line);
  };
  const reportSummary = () => {
    const summary = formatModelSummary(summarizeModels(traceEvents));
    if (summary) console.error(summary);
  };

  if (rest.includes("--live")) {
    const { renderLiveHtml } = await import("@loop-lang/viz");
    const { startLiveServer } = await import("./serve.js");
    const html = renderLiveHtml(file, { title: basename(fileArg) });
    const srv = await startLiveServer(html);
    console.error(`\n  ↻ Loop live dashboard → http://127.0.0.1:${srv.port}\n`);
    const outcomes = await run(file, { ...baseOpts, onEvent: (e) => { srv.emit(e); onTrace(e); } });
    reportSummary();
    const ok = outcomes.every((o) => o.satisfied);
    // Keep the dashboard up after the run — a fast loop can finish before the browser even
    // connects; leaving it alive lets the page load + replay and the user review the result.
    console.error(`  ↻ dashboard still live → http://127.0.0.1:${srv.port}  (Ctrl-C to exit)`);
    const shutdown = () => { srv.close(); process.exit(ok ? 0 : 1); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const outcomes = await run(file, { ...baseOpts, onEvent: onTrace });
  reportSummary();
  // Observability: when `observe:` is on, print the OpEx report (token burn made visible).
  if (file.config?.observe?.trace || file.config?.observe?.meter) {
    console.error(formatOpexSummary(summarizeOpex(traceEvents)));
  }
  const ok = outcomes.every((o) => o.satisfied);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
