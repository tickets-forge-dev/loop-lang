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
  // fresh /events client would miss everything up to its connect. Each event gets a
  // monotonic id; on (re)connect we replay only the events newer than the client's
  // Last-Event-ID, so a transient drop + EventSource auto-reconnect doesn't re-deliver
  // (and thus duplicate) what the page already saw.
  // ponytail: bounded ring (last 10k events) — the dashboard reconstructs state from the
  // stream, so dropping the oldest events on a very long run is harmless.
  const buffer: { id: number; data: string }[] = [];
  const BUFFER_CAP = 10_000;
  let seq = 0;

  function frame(id: number, data: string): string {
    return `id: ${id}\ndata: ${data}\n\n`;
  }
  function broadcast(e: unknown): void {
    const id = ++seq;
    const data = JSON.stringify(e);
    buffer.push({ id, data });
    if (buffer.length > BUFFER_CAP) buffer.shift();
    const f = frame(id, data);
    for (const c of [...clients]) {
      try { c.write(f); } catch { /* client disconnected */ }
    }
  }

  // SSE heartbeat: a comment line keeps idle connections alive through proxies / NAT.
  // unref so it never keeps the process alive on its own (the listening socket does that).
  const heartbeat = setInterval(() => {
    for (const c of [...clients]) {
      try { c.write(": ping\n\n"); } catch { /* disconnected */ }
    }
  }, 15_000);
  heartbeat.unref?.();

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");
        // Replay only events the client hasn't already seen (0 if a first connect).
        const lastId = Number(req.headers["last-event-id"]) || 0;
        for (const ev of buffer) if (ev.id > lastId) res.write(frame(ev.id, ev.data));
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
        close() { clearInterval(heartbeat); server.close(); },
      });
    });
  });
}
