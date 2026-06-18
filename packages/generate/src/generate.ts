import { spawn } from "node:child_process";
import { parse, ParseError, type LoopFile } from "@loop/parser";
import { GRAMMAR } from "./grammar.js";

/** A text backend: given a prompt, return the model's raw text. Injected for testing. */
export type TextBackend = (prompt: string) => Promise<string>;

export interface GenerateOptions {
  /** LLM backend. Defaults to driving the local `claude` CLI. */
  backend?: TextBackend;
  /** Max generate→parse→repair attempts before giving up. */
  maxAttempts?: number;
  /** Model alias for the default Claude backend. */
  model?: string;
}

export interface GenerateResult {
  source: string;
  spec: LoopFile;
  attempts: number;
}

/** Strip a ```loop fenced block if the model wrapped its answer despite instructions. */
function stripFences(s: string): string {
  const fenced = s.match(/```(?:loop|yaml|text)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : s).trim();
}

function buildPrompt(intent: string, repair: string): string {
  return [
    GRAMMAR,
    "",
    "USER REQUEST:",
    intent,
    repair,
    "",
    "Now output the .loop flow for this request. Only the .loop content.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Turn a natural-language description into a validated .loop flow.
 *
 * This is loop engineering applied to itself: generate → parse (verify) → on a
 * parse error, feed the error back and regenerate, up to `maxAttempts`.
 */
export async function generateLoop(intent: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const backend = opts.backend ?? makeClaudeBackend(opts.model);
  const max = opts.maxAttempts ?? 3;
  let repair = "";

  for (let attempt = 1; attempt <= max; attempt++) {
    const raw = await backend(buildPrompt(intent, repair));
    const source = stripFences(raw);
    try {
      const spec = parse(source);
      return { source, spec, attempts: attempt };
    } catch (err) {
      if (!(err instanceof ParseError) || attempt === max) {
        throw err instanceof ParseError
          ? new Error(`could not generate a valid .loop after ${max} attempts: ${err.message}`)
          : err;
      }
      repair = [
        "",
        "Your previous output did NOT parse. Error:",
        err.message,
        "Your previous output was:",
        source,
        "Fix the problem and output only the corrected .loop.",
      ].join("\n");
    }
  }
  // Unreachable (loop either returns or throws), but satisfies the type checker.
  throw new Error(`could not generate a valid .loop after ${max} attempts`);
}

/** Default backend: drive the local `claude` CLI headless, no tools (pure text gen). */
export function makeClaudeBackend(model?: string, bin = "claude"): TextBackend {
  return (prompt: string) =>
    new Promise((resolve, reject) => {
      const args = ["-p", prompt, "--output-format", "json", "--allowedTools"];
      if (model) args.push("--model", model);
      const child = spawn(bin, args);
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && !out) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
        try {
          const parsed = JSON.parse(out.trim());
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          const result = [...arr].reverse().find((m) => m?.type === "result");
          resolve(result?.result ?? "");
        } catch {
          resolve(out.trim());
        }
      });
    });
}
