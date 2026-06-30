import { randomUUID } from "node:crypto";
import type { LoopEvent } from "./types.js";

/** Run metadata sent alongside events so the collector can attribute a run. */
export interface RunMeta {
  loop_path?: string;
  loop_name?: string;
  git_sha?: string;
  principal?: string;
  runner?: string;
}

export interface EventSink {
  /** Fire-and-forget: enqueue one event for delivery. Never throws. */
  post(event: LoopEvent): void;
  /** Await all in-flight deliveries (call before exit so the tail isn't lost). Never throws. */
  flush(): Promise<void>;
}

/**
 * Stream Loop runtime events to a control-plane collector over HTTP.
 *
 * Best-effort by design: an unreachable or failing collector never throws and never blocks a
 * run — telemetry must not be able to break a loop. The server is idempotent on the monotonic
 * per-run `seq`, so out-of-order or retried delivery is safe.
 */
export function makeHttpEventSink(opts: {
  url: string;
  runId: string;
  token?: string;
  meta?: RunMeta;
}): EventSink {
  const endpoint = `${opts.url.replace(/\/+$/, "")}/api/v1/runs/${encodeURIComponent(opts.runId)}/events`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers["x-api-token"] = opts.token;
  let seq = 0;
  const inflight = new Set<Promise<unknown>>();
  return {
    post(event) {
      const body = JSON.stringify({ meta: opts.meta, events: [{ seq: seq++, event }] });
      const p = fetch(endpoint, { method: "POST", headers, body })
        .then((r) => r.body?.cancel?.())
        .catch(() => {
          /* best-effort: telemetry must never break a run */
        });
      inflight.add(p);
      void p.finally(() => inflight.delete(p));
    },
    async flush() {
      await Promise.allSettled([...inflight]);
    },
  };
}

/**
 * Build a sink from the environment. Returns undefined when `LOOP_EVENTS_URL` is unset, so a run
 * with no control plane configured streams nowhere and behaves exactly as before.
 *   LOOP_EVENTS_URL    — collector base URL (required to enable)
 *   LOOP_EVENTS_TOKEN  — shared API token (optional)
 *   LOOP_RUN_ID        — correlate events to one run (optional; a UUID is generated if unset)
 */
export function eventSinkFromEnv(meta?: RunMeta): EventSink | undefined {
  const url = process.env.LOOP_EVENTS_URL;
  if (!url) return undefined;
  return makeHttpEventSink({
    url,
    runId: process.env.LOOP_RUN_ID || randomUUID(),
    token: process.env.LOOP_EVENTS_TOKEN,
    meta,
  });
}
