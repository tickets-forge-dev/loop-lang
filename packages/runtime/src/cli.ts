#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parse } from "@loop/parser";
import { resolvePreset } from "@loop/stdlib";
import { run } from "./engine.js";
import { ShellVerifier } from "./verify.js";
import { CliHumanIO } from "./human.js";
import { ClaudeCodeRunner } from "./runners/claudeCode.js";
import { HttpArchonPlanSource } from "./runners/archon.js";
import { IpcHumanIO } from "./ipc.js";
import type { LoopEvent } from "./types.js";

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
    default:
      return "";
  }
}

async function main() {
  const [cmd, fileArg, ...rest] = process.argv.slice(2);
  if (!cmd || (cmd !== "run" && cmd !== "parse" && cmd !== "export" && cmd !== "viz") || !fileArg) {
    console.error("usage: loop <run|parse|export|viz> <file.loop>  [--model <alias>] [--out <path>]");
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
    const { renderHtml } = await import("@loop/viz");
    const html = renderHtml(file, { title: fileArg.split("/").pop() });
    const vOutIdx = rest.indexOf("--out");
    const dest = resolve(process.cwd(), vOutIdx >= 0 ? rest[vOutIdx + 1] : fileArg.replace(/\.loop$/, "") + ".html");
    writeFileSync(dest, html);
    console.error(`wrote ${dest}`);
    return;
  }

  // Optional interop: export to Archon workflow YAML instead of running natively.
  if (cmd === "export") {
    const { exportToArchonYaml } = await import("@loop/export-archon");
    const outIdx = rest.indexOf("--out");
    const outDir = outIdx >= 0 ? resolve(process.cwd(), rest[outIdx + 1]) : null;
    const workflows = exportToArchonYaml(file);
    for (const wf of workflows) {
      if (outDir) {
        const dest = resolve(outDir, `${wf.name}.yaml`);
        writeFileSync(dest, wf.yaml);
        console.log(`wrote ${dest}`);
      } else {
        console.log(`# --- ${wf.name}.yaml ---`);
        console.log(wf.yaml);
      }
    }
    return;
  }

  const modelIdx = rest.indexOf("--model");
  const model = modelIdx >= 0 ? rest[modelIdx + 1] : undefined;
  const target = file.config?.target ? resolve(baseDir, file.config.target) : baseDir;

  // Archon plan source, if any loop uses `plan from archon` and ARCHON_URL is set.
  const archon = process.env.ARCHON_URL
    ? new HttpArchonPlanSource({
        baseUrl: process.env.ARCHON_URL,
        token: process.env.ARCHON_TOKEN,
        codebaseId: process.env.ARCHON_CODEBASE_ID,
      })
    : undefined;

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
      runner: new ClaudeCodeRunner({ model, onActivity: (node, text) => emit({ kind: "agent", node, text }) }),
      verifier: new ShellVerifier(),
      human: ipc,
      archon,
      baseDir: target,
      loadFile,
      readText,
      flowStack: [path],
      onEvent: (e) => emit({ kind: "event", event: e }),
    });
    const ok = outcomes.every((o) => o.satisfied);
    emit({ kind: "end", ok });
    rl.close();
    process.exit(ok ? 0 : 1);
  }

  const outcomes = await run(file, {
    runner: new ClaudeCodeRunner({ model }),
    verifier: new ShellVerifier(),
    human: new CliHumanIO(),
    archon,
    baseDir: target,
    loadFile,
    readText,
    flowStack: [path],
    onEvent: (e) => {
      const line = render(e);
      if (line) console.log(line);
    },
  });

  const ok = outcomes.every((o) => o.satisfied);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
