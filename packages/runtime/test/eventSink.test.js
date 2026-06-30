import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeHttpEventSink } from "../dist/eventSink.js";

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
  sink.post({ type: "ctx", action: "provision", skills: ["a"] });
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
  assert.equal(bySeq.get(1).type, "ctx");
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
