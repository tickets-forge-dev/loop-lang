import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LoopEvent } from "./types.js";
import { buildRedactor, redactEvent } from "./redact.js";

/** Run metadata sent alongside events so the collector can attribute a run. */
export interface RunMeta {
  loop_path?: string;
  loop_name?: string;
  git_sha?: string;
  principal?: string;
  runner?: string;
  /** sha256 of the .loop source — lets `--resume` warn when the file changed since the logged run. */
  loop_sha256?: string;
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
 * Append every Loop runtime event to a local NDJSON log file — one JSON object per line.
 *
 * The first line is a `loop.log.v1` header (runId + meta); every subsequent line is
 * `{ seq, ts, event }`. Writes are synchronous appends, so each event is durable the instant it
 * fires — the log survives a Ctrl-C or crash with no lost tail (nothing is buffered, so `flush()`
 * is a no-op). Best-effort like the HTTP sink: a missing directory is created once, and any write
 * error disables the sink quietly rather than breaking the run.
 */
export function makeFileEventSink(opts: { path: string; runId: string; meta?: RunMeta }): EventSink {
  let seq = 0;
  let broken = false;
  let started = false;
  const line = (obj: unknown): void => {
    if (broken) return;
    try {
      appendFileSync(opts.path, JSON.stringify(obj) + "\n");
    } catch {
      broken = true;
    }
  };
  const start = (): void => {
    if (started) return;
    started = true;
    try {
      mkdirSync(dirname(opts.path), { recursive: true });
    } catch {
      /* dir may already exist or be uncreatable — the append below decides if we can log */
    }
    line({ v: "loop.log.v1", runId: opts.runId, ts: new Date().toISOString(), meta: opts.meta });
  };
  return {
    post(event) {
      start();
      line({ seq: seq++, ts: new Date().toISOString(), event });
    },
    async flush() {
      /* appendFileSync is durable — nothing is buffered */
    },
  };
}

/**
 * Wrap a sink so every event is secret-scrubbed before delivery (see redact.ts). Sits in front
 * of both the file log and the HTTP collector — persisted telemetry never sees a raw credential.
 */
export function redactingSink(sink: EventSink, redact: (s: string) => string): EventSink {
  return {
    post(event) {
      let scrubbed = event;
      try {
        scrubbed = redactEvent(event, redact);
      } catch {
        /* a redactor bug must never break telemetry — fall back to the raw event */
      }
      sink.post(scrubbed);
    },
    flush: () => sink.flush(),
  };
}

/** Fan one event stream out to several sinks. Returns undefined when none are active. */
export function combineSinks(sinks: Array<EventSink | undefined>): EventSink | undefined {
  const active = sinks.filter((s): s is EventSink => !!s);
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  return {
    post(event) {
      for (const s of active) s.post(event);
    },
    async flush() {
      await Promise.allSettled(active.map((s) => s.flush()));
    },
  };
}

/**
 * Build a sink from the environment (plus optional explicit overrides). Returns undefined when no
 * telemetry is configured, so a run with no sink streams nowhere and behaves exactly as before.
 * When more than one is active, events fan out to all — sharing one run id so the HTTP collector
 * and the local log correlate.
 *   LOOP_EVENTS_URL    — control-plane collector base URL (enables the HTTP sink)
 *   LOOP_EVENTS_TOKEN  — shared API token for the collector (optional)
 *   LOOP_LOG_FILE      — local NDJSON log path (enables the file sink)
 *   LOOP_RUN_ID        — correlate events to one run (optional; a UUID is generated if unset)
 *
 * `override.logFile` (the CLI's `--log <path>`) takes precedence over `LOOP_LOG_FILE`.
 *
 * Secret redaction is ON by default (see redact.ts); set `LOOP_REDACT=off` to disable.
 */
export function eventSinkFromEnv(meta?: RunMeta, override?: { logFile?: string }): EventSink | undefined {
  const runId = process.env.LOOP_RUN_ID || randomUUID();
  const url = process.env.LOOP_EVENTS_URL;
  const logPath = override?.logFile || process.env.LOOP_LOG_FILE;
  const sink = combineSinks([
    url ? makeHttpEventSink({ url, runId, token: process.env.LOOP_EVENTS_TOKEN, meta }) : undefined,
    logPath ? makeFileEventSink({ path: logPath, runId, meta }) : undefined,
  ]);
  if (!sink || process.env.LOOP_REDACT === "off") return sink;
  return redactingSink(sink, buildRedactor());
}
