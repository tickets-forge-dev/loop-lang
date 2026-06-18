#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "@loop/parser";
import { resolvePreset } from "@loop/stdlib";
import { run } from "./engine.js";
import { ShellVerifier } from "./verify.js";
import { CliHumanIO } from "./human.js";
import { ClaudeCodeRunner } from "./runners/claudeCode.js";
import { HttpArchonPlanSource } from "./runners/archon.js";
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

  const outcomes = await run(file, {
    runner: new ClaudeCodeRunner({ model }),
    verifier: new ShellVerifier(),
    human: new CliHumanIO(),
    archon,
    baseDir: target,
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
