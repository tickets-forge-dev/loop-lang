import { spawn } from "node:child_process";
import type { ActInput, ActResult, PlanInput, ReflectInput, Runner } from "../types.js";

/** Maps loop action-classes to Claude Code tool grants. Read tools are always allowed. */
const READ_TOOLS = ["Read", "Grep", "Glob"];
const CLASS_TOOLS: Record<string, string[]> = {
  edit: ["Edit", "Write", "MultiEdit", "NotebookEdit"],
  push: ["Bash(git push:*)"],
  migrate: ["Bash"],
  deploy: ["Bash"],
  delete: ["Bash(rm:*)"],
};

export type AgentNode = "plan" | "act" | "reflect";

export interface ClaudeCodeRunnerOptions {
  /** Model alias (e.g. "opus", "sonnet") or full id. Omit to use the CLI default. */
  model?: string;
  /** Path to the claude binary. Default "claude" on PATH. */
  bin?: string;
  /** Max agent turns per node invocation. */
  maxTurns?: number;
  /**
   * When set, the runner streams Claude's live activity (text + tool use) via
   * `--output-format stream-json` and forwards each piece here as it happens,
   * tagged by which node produced it. Without it, output is buffered per node.
   */
  onActivity?: (node: AgentNode, text: string) => void;
}

interface ClaudeJsonResult {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const firstLines = (s: string, n: number): string[] => s.replace(/\n+$/, "").split("\n").slice(0, n);

/**
 * Build the plan-step prompt. Pure + exported so it can be tested without spawning.
 */
export function buildPlanPrompt(input: PlanInput): string {
  const ctx: string[] = [];
  if (input.files.length) ctx.push(`Relevant context (each item is a file or a description of one — locate the actual file(s) first): ${input.files.join(", ")}.`);
  if (input.includeLastFailure) ctx.push("Account for the most recent failure.");
  if (input.reflection) ctx.push(`From the last attempt: ${input.reflection}`);
  if (input.upstream) ctx.push(`From the previous step in the flow:\n${input.upstream}`);
  return [
    `Goal: ${input.goal}.`,
    ...ctx,
    "Produce a concise, concrete step-by-step plan to achieve the goal. Do not edit files yet.",
  ].join("\n");
}

/**
 * Interpret one line of `--output-format stream-json` NDJSON into human-facing activity:
 * assistant text, thinking, tool calls *with their inputs* (commands, file paths, diffs),
 * and tool results — i.e. enough to *watch the Claude session*, not just labels. Pure + tested.
 */
export function interpretStreamLine(line: string): { activities: string[]; result?: string } {
  const trimmed = line.trim();
  if (!trimmed) return { activities: [] };
  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { activities: [] };
  }
  if (obj?.type === "result") return { activities: [], result: typeof obj.result === "string" ? obj.result : "" };

  if (obj?.type === "assistant" && Array.isArray(obj.message?.content)) {
    const activities: string[] = [];
    for (const block of obj.message.content) {
      if (block?.type === "text" && block.text?.trim()) activities.push(block.text.trim());
      else if (block?.type === "thinking" && block.thinking?.trim()) activities.push("💭 " + clip(block.thinking.trim(), 200));
      else if (block?.type === "tool_use") activities.push(...toolLines(block));
    }
    return { activities };
  }

  // tool results come back as a "user" message — surface a brief preview
  if (obj?.type === "user" && Array.isArray(obj.message?.content)) {
    const activities: string[] = [];
    for (const block of obj.message.content) {
      if (block?.type === "tool_result") {
        const txt = resultText(block.content);
        if (txt) for (const ln of firstLines(txt, 3)) activities.push("  ⤷ " + clip(ln, 120));
      }
    }
    return { activities };
  }
  return { activities: [] };
}

function toolLines(block: { name?: string; input?: Record<string, unknown> }): string[] {
  const name = block.name ?? "tool";
  const i = block.input ?? {};
  const out: string[] = [];
  let suffix = "";
  if (typeof i.file_path === "string") suffix = " " + (i.file_path.split("/").pop() ?? i.file_path);
  else if (typeof i.path === "string") suffix = " " + i.path;
  else if (typeof i.pattern === "string") suffix = " /" + i.pattern + "/";
  out.push("● " + name + suffix);
  if (typeof i.command === "string") out.push("   $ " + clip(i.command, 200));
  if (typeof i.old_string === "string" && firstLines(i.old_string, 1)[0]) out.push("   - " + clip(firstLines(i.old_string, 1)[0], 100));
  if (typeof i.new_string === "string" && firstLines(i.new_string, 1)[0]) out.push("   + " + clip(firstLines(i.new_string, 1)[0], 100));
  if (typeof i.content === "string" && !i.old_string && firstLines(i.content, 1)[0]) out.push("   ✎ " + clip(firstLines(i.content, 1)[0], 100));
  return out;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === "string" ? c : c?.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Drives Claude Code in headless mode (`claude -p`). The prompt is passed as an argv
 * element (no shell). With `onActivity` set it streams via stream-json; otherwise it
 * uses buffered json.
 */
export class ClaudeCodeRunner implements Runner {
  constructor(private opts: ClaudeCodeRunnerOptions = {}) {}

  private run(prompt: string, flags: string[], baseDir: string, node: AgentNode): Promise<string> {
    const bin = this.opts.bin ?? "claude";
    const stream = !!this.opts.onActivity;
    const args = ["-p", prompt, "--add-dir", baseDir];
    args.push("--output-format", stream ? "stream-json" : "json");
    if (stream) args.push("--verbose");
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.maxTurns) args.push("--max-turns", String(this.opts.maxTurns));
    args.push(...flags);

    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd: baseDir });
      let stdout = "";
      let stderr = "";
      let streamed = "";
      let buf = "";
      let lastResult: string | undefined;
      child.stdout.on("data", (d) => {
        stdout += d;
        if (!stream) return;
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const r = interpretStreamLine(line);
          for (const a of r.activities) this.opts.onActivity!(node, a);
          if (r.result !== undefined) {
            lastResult = r.result;
            streamed = r.result;
          }
        }
      });
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && !stdout) {
          reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(stream ? (lastResult ?? streamed) : extractResult(stdout));
      });
    });
  }

  async plan(input: PlanInput): Promise<string> {
    const prompt = buildPlanPrompt(input);
    return this.run(prompt, ["--permission-mode", "plan", "--allowedTools", ...READ_TOOLS], input.baseDir, "plan");
  }

  async act(input: ActInput): Promise<ActResult> {
    const tools = new Set(READ_TOOLS);
    let canEdit = false;
    for (const cls of input.allowedClasses) {
      for (const t of CLASS_TOOLS[cls] ?? []) tools.add(t);
      if (cls === "edit") canEdit = true;
    }
    const mode = canEdit ? "acceptEdits" : "default";
    const prompt = [
      `Goal: ${input.goal}.`,
      `Execute this plan, making the smallest coherent change:`,
      input.plan,
      `Only use the capabilities you have been granted.`,
    ].join("\n");
    const summary = await this.run(
      prompt,
      ["--permission-mode", mode, "--allowedTools", ...tools],
      input.baseDir,
      "act"
    );
    return { summary };
  }

  async reflect(input: ReflectInput): Promise<string> {
    const prompt = [
      `Goal: ${input.goal}.`,
      `The verification did not pass. Output was:`,
      input.output || "(no output)",
      input.focus ? `Reflect specifically on: ${input.focus}.` : `Reflect on why it failed.`,
      `In 2-4 sentences, explain the likely cause and what to change next. Do not edit files.`,
    ].join("\n");
    return this.run(prompt, ["--permission-mode", "plan", "--allowedTools", ...READ_TOOLS], input.baseDir, "reflect");
  }
}

function extractResult(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const last = [...parsed].reverse().find((m: ClaudeJsonResult) => m.type === "result");
      return last?.result ?? "";
    }
    const obj = parsed as ClaudeJsonResult;
    return obj.result ?? "";
  } catch {
    // Not JSON (e.g. text format) — return as-is.
    return trimmed;
  }
}
