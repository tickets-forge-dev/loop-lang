import { test } from "node:test";
import assert from "node:assert/strict";
import { startLiveServer } from "../dist/serve.js";

// Read an SSE stream for a short window, then cancel — returns whatever arrived.
async function drain(url, headers, ms = 250) {
  const reader = await fetch(url, { headers }).then((r) => r.body.getReader());
  let out = "";
  const dec = new TextDecoder();
  const t = setTimeout(() => reader.cancel().catch(() => {}), ms);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
  } catch { /* cancelled */ }
  clearTimeout(t);
  return out;
}
const ids = (s) => [...s.matchAll(/id: (\d+)/g)].map((m) => m[1]);

test("live server replays buffered events and dedupes on Last-Event-ID", async () => {
  const srv = await startLiveServer("<html>x</html>", { open: false });
  const url = `http://127.0.0.1:${srv.port}/events`;
  srv.emit({ type: "a" });
  srv.emit({ type: "b" });
  srv.emit({ type: "c" });

  const fresh = await drain(url, {});
  assert.deepEqual(ids(fresh), ["1", "2", "3"], "fresh connect replays all buffered events");

  const reconn = await drain(url, { "Last-Event-ID": "2" });
  assert.deepEqual(ids(reconn), ["3"], "reconnect replays only events newer than Last-Event-ID");
  assert.ok(!reconn.includes('"a"') && !reconn.includes('"b"'), "no duplicate of already-seen events");

  srv.close();
});

test("live server serves the page on GET / and accepts POST /emit", async () => {
  const srv = await startLiveServer("<html>LIVE</html>", { open: false });
  const base = `http://127.0.0.1:${srv.port}`;

  const page = await fetch(base).then((r) => r.text());
  assert.match(page, /LIVE/, "serves the html");

  const ok = await fetch(`${base}/emit`, { method: "POST", body: JSON.stringify({ type: "x" }) });
  assert.equal(ok.status, 204, "valid emit accepted");
  const bad = await fetch(`${base}/emit`, { method: "POST", body: "not json" });
  assert.equal(bad.status, 400, "malformed emit rejected");

  srv.close();
});
