import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeHttpEventSink, makeFileEventSink, combineSinks, eventSinkFromEnv } from "../dist/eventSink.js";

/** A throwaway HTTP server that records every request body. */
function recordingServer(received) {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ url: req.url, token: req.headers["x-api-token"], body: JSON.parse(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
}

test("http event sink posts each event with a monotonic seq + token to the run endpoint", async () => {
  const received = [];
  const srv = recordingServer(received);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;

  const sink = makeHttpEventSink({
    url: `http://127.0.0.1:${port}`,
    runId: "r1",
    token: "secret",
    meta: { loop_path: "x.loop", principal: "ci" },
  });
  sink.post({ type: "loop-start", name: "n" });
  sink.post({ type: "git", action: "branch", detail: "loop/x" });
  sink.post({ type: "loop-end", satisfied: true });
  await sink.flush();
  srv.close();

  assert.equal(received.length, 3);
  for (const r of received) {
    assert.equal(r.url, "/api/v1/runs/r1/events");
    assert.equal(r.token, "secret");
    assert.equal(r.body.meta.loop_path, "x.loop");
  }
  // seq is assigned synchronously at post() time, so it's deterministic regardless of arrival order.
  const bySeq = new Map(received.map((r) => [r.body.events[0].seq, r.body.events[0].event]));
  assert.deepEqual([...bySeq.keys()].sort((a, b) => a - b), [0, 1, 2]);
  assert.equal(bySeq.get(0).type, "loop-start");
  assert.equal(bySeq.get(1).type, "git");
});

test("sink degrades silently when the collector is unreachable (never throws)", async () => {
  const sink = makeHttpEventSink({ url: "http://127.0.0.1:1", runId: "r2" }); // nothing listening
  sink.post({ type: "loop-start" });
  await assert.doesNotReject(sink.flush());
});

test("no token header when none configured", async () => {
  const received = [];
  const srv = recordingServer(received);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const sink = makeHttpEventSink({ url: `http://127.0.0.1:${port}/`, runId: "r3" });
  sink.post({ type: "stop", reason: "done" });
  await sink.flush();
  srv.close();
  assert.equal(received.length, 1);
  assert.equal(received[0].token, undefined);
  assert.equal(received[0].url, "/api/v1/runs/r3/events"); // trailing slash on base url trimmed
});

test("file sink writes a header line then one NDJSON line per event", async () => {
  const dir = join(tmpdir(), `loop-log-${process.pid}-${Date.now()}`);
  const path = join(dir, "nested", "run.log"); // nested dir must be created
  try {
    const sink = makeFileEventSink({ path, runId: "r1", meta: { loop_path: "x.loop", principal: "ci" } });
    sink.post({ type: "loop-start", name: "n" });
    sink.post({ type: "observe", passed: true, output: "ok" });
    sink.post({ type: "loop-end", satisfied: true });
    await sink.flush();

    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 4); // header + 3 events

    // header
    assert.equal(lines[0].v, "loop.log.v1");
    assert.equal(lines[0].runId, "r1");
    assert.equal(lines[0].meta.loop_path, "x.loop");
    assert.ok(lines[0].ts, "header has a timestamp");

    // events carry a monotonic seq starting at 0, a ts, and the original event
    assert.deepEqual(lines.slice(1).map((l) => l.seq), [0, 1, 2]);
    assert.equal(lines[1].event.type, "loop-start");
    assert.equal(lines[2].event.type, "observe");
    assert.equal(lines[3].event.type, "loop-end");
    assert.ok(lines[1].ts, "event has a timestamp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file sink degrades silently on an unwritable path (never throws)", async () => {
  // A path whose parent is a file, not a directory → mkdir/append both fail.
  const dir = join(tmpdir(), `loop-log-bad-${process.pid}-${Date.now()}`);
  const blocker = join(dir, "blocker");
  const path = join(blocker, "run.log"); // blocker will be a file, so this dir can't exist
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(blocker, "x");
    const sink = makeFileEventSink({ path, runId: "r2" });
    assert.doesNotThrow(() => sink.post({ type: "loop-start" }));
    assert.doesNotThrow(() => sink.post({ type: "loop-end", satisfied: false }));
    await assert.doesNotReject(sink.flush());
    assert.ok(!existsSync(path), "nothing was written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combineSinks fans one event out to every sink and flushes all", async () => {
  const dir = join(tmpdir(), `loop-log-combine-${process.pid}-${Date.now()}`);
  const path = join(dir, "run.log");
  const received = [];
  const srv = recordingServer(received);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const combined = combineSinks([
      makeHttpEventSink({ url: `http://127.0.0.1:${port}`, runId: "rc" }),
      makeFileEventSink({ path, runId: "rc" }),
      undefined, // an inactive sink is skipped
    ]);
    combined.post({ type: "loop-start", name: "n" });
    combined.post({ type: "loop-end", satisfied: true });
    await combined.flush();
    srv.close();

    assert.equal(received.length, 2, "HTTP sink got both events");
    const fileLines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(fileLines.length, 3, "file sink got header + both events");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combineSinks returns undefined when no sink is active", () => {
  assert.equal(combineSinks([undefined, undefined]), undefined);
});

test("eventSinkFromEnv is inert with no env and no override", () => {
  const saved = { url: process.env.LOOP_EVENTS_URL, log: process.env.LOOP_LOG_FILE };
  delete process.env.LOOP_EVENTS_URL;
  delete process.env.LOOP_LOG_FILE;
  try {
    assert.equal(eventSinkFromEnv({ loop_path: "x.loop" }), undefined);
  } finally {
    if (saved.url !== undefined) process.env.LOOP_EVENTS_URL = saved.url;
    if (saved.log !== undefined) process.env.LOOP_LOG_FILE = saved.log;
  }
});

test("eventSinkFromEnv: --log override beats LOOP_LOG_FILE", async () => {
  const dir = join(tmpdir(), `loop-log-override-${process.pid}-${Date.now()}`);
  const envPath = join(dir, "from-env.log");
  const flagPath = join(dir, "from-flag.log");
  const saved = process.env.LOOP_LOG_FILE;
  process.env.LOOP_LOG_FILE = envPath;
  try {
    const sink = eventSinkFromEnv({ loop_path: "x.loop" }, { logFile: flagPath });
    sink.post({ type: "loop-start", name: "n" });
    await sink.flush();
    assert.ok(existsSync(flagPath), "flag path was written");
    assert.ok(!existsSync(envPath), "env path was NOT written (flag overrode it)");
  } finally {
    if (saved !== undefined) process.env.LOOP_LOG_FILE = saved;
    else delete process.env.LOOP_LOG_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});
