import { createServer } from "node:http";
import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoopEvent } from "./types.js";

export interface LiveServer {
  emit(e: LoopEvent): void;
  port: number;
  close(): void;
}

/** Start a minimal HTTP+SSE server for the live dashboard.
 *  GET /        → serves the pre-rendered HTML page
 *  GET /events  → SSE stream of LoopEvent NDJSON
 *  Auto-opens the browser (best-effort; skips silently on failure).
 */
export function startLiveServer(html: string): Promise<LiveServer> {
  const clients: ServerResponse[] = [];

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");
        clients.push(res);
        req.on("close", () => {
          const i = clients.indexOf(res);
          if (i >= 0) clients.splice(i, 1);
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
      // Best-effort browser open — platform-specific, ignore failures
      const opener = process.platform === "darwin" ? "open"
        : process.platform === "win32" ? "start"
        : "xdg-open";
      execFile(opener, [url], () => { /* ignore errors */ });

      resolve({
        port: addr.port,
        emit(e: LoopEvent) {
          const data = `data: ${JSON.stringify(e)}\n\n`;
          for (const c of [...clients]) {
            try { c.write(data); } catch { /* client disconnected */ }
          }
        },
        close() { server.close(); },
      });
    });
  });
}
