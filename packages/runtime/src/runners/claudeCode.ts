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

export interface ClaudeCodeRunnerOptions {
  /** Model alias (e.g. "opus", "sonnet") or full id. Omit to use the CLI default. */
  model?: string;
  /** Path to the claude binary. Default "claude" on PATH. */
  bin?: string;
  /** Max agent turns per node invocation. */
  maxTurns?: number;
}

interface ClaudeJsonResult {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

/**
 * Drives Claude Code in headless mode (`claude -p ... --output-format json`).
 * The prompt is passed as an argv element (no shell), so its contents are not
 * interpreted by a shell.
 */
export class ClaudeCodeRunner implements Runner {
  constructor(private opts: ClaudeCodeRunnerOptions = {}) {}

  private run(prompt: string, flags: string[], baseDir: string): Promise<string> {
    const bin = this.opts.bin ?? "claude";
    const args = ["-p", prompt, "--output-format", "json", "--add-dir", baseDir];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.maxTurns) args.push("--max-turns", String(this.opts.maxTurns));
    args.push(...flags);

    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd: baseDir });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && !stdout) {
          reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(extractResult(stdout));
      });
    });
  }

  async plan(input: PlanInput): Promise<string> {
    const ctx: string[] = [];
    if (input.files.length) ctx.push(`Relevant files: ${input.files.join(", ")}.`);
    if (input.includeLastFailure) ctx.push("Account for the most recent failure.");
    if (input.reflection) ctx.push(`From the last attempt: ${input.reflection}`);
    const prompt = [
      `Goal: ${input.goal}.`,
      ...ctx,
      "Produce a concise, concrete step-by-step plan to achieve the goal. Do not edit files yet.",
    ].join("\n");
    return this.run(prompt, ["--permission-mode", "plan", "--allowedTools", ...READ_TOOLS], input.baseDir);
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
      input.baseDir
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
    return this.run(prompt, ["--permission-mode", "plan", "--allowedTools", ...READ_TOOLS], input.baseDir);
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
