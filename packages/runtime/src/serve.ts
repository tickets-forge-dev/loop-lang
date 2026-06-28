import { createServer } from "node:http";
import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoopEvent } from "./types.js";

export interface LiveServer {
  emit(e: LoopEvent): void;
  port: number;
  close(): void;
}

export interface LiveServerOptions {
  /** Open the browser automatically (default true). */
  open?: boolean;
}

/** Start a minimal HTTP+SSE server for the live dashboard.
 *  GET  /        → serves the pre-rendered HTML page
 *  GET  /events  → SSE stream of LoopEvent NDJSON
 *  POST /emit    → push a LoopEvent (JSON body) to broadcast to all clients;
 *                  this is how an out-of-process driver (the /loopflow skill via
 *                  `loop-run emit`) feeds a live in-session run.
 *  Auto-opens the browser (best-effort; skips silently on failure).
 */
export function startLiveServer(html: string, opts: LiveServerOptions = {}): Promise<LiveServer> {
  const clients: ServerResponse[] = [];
  // Replay buffer: events fire before the browser finishes launching + connecting, so a
  // fresh /events client would miss everything up to its connect. Buffer and replay on
  // connect. ponytail: bounded ring (last 10k events) — the dashboard reconstructs state
  // from the stream, so dropping the oldest events on a very long run is harmless.
  const buffer: unknown[] = [];
  const BUFFER_CAP = 10_000;

  function broadcast(e: unknown): void {
    buffer.push(e);
    if (buffer.length > BUFFER_CAP) buffer.shift();
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of [...clients]) {
      try { c.write(data); } catch { /* client disconnected */ }
    }
  }

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");
        for (const past of buffer) res.write(`data: ${JSON.stringify(past)}\n\n`);
        clients.push(res);
        req.on("close", () => {
          const i = clients.indexOf(res);
          if (i >= 0) clients.splice(i, 1);
        });
      } else if (req.method === "POST" && req.url === "/emit") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy(); // cap: refuse oversized payloads
        });
        req.on("end", () => {
          try {
            broadcast(JSON.parse(body));
            res.writeHead(204);
            res.end();
          } catch {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("invalid JSON");
          }
        });
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      }
    });

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      if (opts.open !== false) {
        // Best-effort browser open — platform-specific, ignore failures.
        // Windows `start` is a cmd.exe built-in (no start.exe), so go via cmd; the empty
        // "" is start's window-title arg, required so the URL isn't taken as the title.
        const [opener, args] = process.platform === "darwin" ? ["open", [url]]
          : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
        execFile(opener, args, () => { /* ignore errors */ });
      }

      resolve({
        port: addr.port,
        emit: broadcast,
        close() { server.close(); },
      });
    });
  });
}
