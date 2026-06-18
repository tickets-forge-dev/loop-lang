import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parse, ParseError } from "@loop/parser";
import { generateLoop } from "@loop/generate";
import {
  run,
  ShellVerifier,
  ClaudeCodeRunner,
  type HumanIO,
  type LoopEvent,
} from "@loop/runtime";
import { editorHtml } from "./editor.js";

export interface StudioOptions {
  port?: number;
  /** Working directory loops run in (defaults to process.cwd()). */
  baseDir?: string;
  /** Model alias for generate + run. */
  model?: string;
}

/** Parse a .loop source; structured result for the editor's live binding. */
export function handleParse(source: string): { ok: true; spec: unknown } | { ok: false; error: string; line?: number } {
  try {
    return { ok: true, spec: parse(source) };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.message, line: err.line };
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/**
 * Human gate for a studio run. Auto-approves plan/review/gate so a browser run does
 * not hang, but DENIES confirm-class actions (push/migrate) so risky operations are
 * withheld — matching the policy semantics. Every decision is surfaced as an event.
 */
class WebHumanIO implements HumanIO {
  constructor(private emit: (e: LoopEvent) => void) {}
  async plan(goal: string) {
    this.emit({ type: "human", kind: "plan", prompt: goal, answer: "auto-approved" });
    return true;
  }
  async review(goal: string) {
    this.emit({ type: "human", kind: "review", prompt: goal, answer: "auto-approved" });
    return true;
  }
  async gate(message: string) {
    this.emit({ type: "human", kind: "gate", prompt: message, answer: "auto-approved" });
    return true;
  }
  async confirm(actionClass: string) {
    this.emit({ type: "human", kind: "confirm", prompt: actionClass, answer: "auto-denied (studio)" });
    return false;
  }
  async ask(prompt: string) {
    this.emit({ type: "human", kind: "ask", prompt });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 1_000_000) req.destroy(); // cap
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, code: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

/** Start the studio server. Binds to 127.0.0.1 only (local dev tool; runs Claude Code + shell). */
export function startStudio(opts: StudioOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const baseDir = opts.baseDir ?? process.cwd();
  const model = opts.model;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        const html = editorHtml();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/parse") {
        const { source } = JSON.parse(await readBody(req));
        json(res, 200, handleParse(source ?? ""));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/generate") {
        const { intent } = JSON.parse(await readBody(req));
        try {
          const result = await generateLoop(intent ?? "", { model });
          json(res, 200, { ok: true, ...result });
        } catch (err) {
          json(res, 200, { ok: false, error: String((err as Error)?.message ?? err) });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        const { source } = JSON.parse(await readBody(req));
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const write = (e: LoopEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        try {
          const file = parse(source ?? "");
          await run(file, {
            runner: new ClaudeCodeRunner({ model }),
            verifier: new ShellVerifier(),
            human: new WebHumanIO(write),
            baseDir,
            onEvent: write,
          });
          res.write(`event: end\ndata: {}\n\n`);
        } catch (err) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: String((err as Error)?.message ?? err) })}\n\n`);
        }
        res.end();
        return;
      }
      res.writeHead(404).end("not found");
    } catch (err) {
      json(res, 500, { error: String((err as Error)?.message ?? err) });
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 4173, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port ?? 4173;
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
