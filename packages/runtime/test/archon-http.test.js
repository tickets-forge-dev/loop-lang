import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpArchonPlanSource } from "../dist/index.js";

/**
 * Stubs global fetch to emulate the real Archon conversation API:
 *   POST /api/conversations          -> { conversationId }
 *   POST /api/conversations/:id/message -> { accepted, status } (async)
 *   GET  /api/conversations/:id/messages -> assistant reply appears after one poll
 */
function stubArchon() {
  const calls = [];
  // Emulate Archon appending a fresh assistant reply for each posted message.
  const messages = [{ id: "u0", role: "user", content: "goal", created_at: "2026-01-01T00:00:00Z" }];
  let seq = 0;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;
    calls.push({ method, path });
    const ok = (body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });

    if (method === "POST" && path === "/api/conversations") return ok({ conversationId: "conv-1" });
    if (method === "POST" && path.endsWith("/message")) {
      seq++;
      messages.push({ id: `a${seq}`, role: "assistant", content: `1. escape the apostrophe (rev ${seq})`, created_at: `2026-01-01T00:00:0${seq}Z` });
      return ok({ accepted: true, status: "dispatched" });
    }
    if (method === "GET" && path.endsWith("/messages")) return ok([...messages]);
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { calls };
}

test("HttpArchonPlanSource: create -> message -> poll -> return plan", async () => {
  const { calls } = stubArchon();
  const src = new HttpArchonPlanSource({ baseUrl: "http://localhost:3737", codebaseId: "cb-9", pollMs: 5, timeoutMs: 3000 });

  const plan = await src.fetchPlan({ goal: "settings save with apostrophe", project: undefined, reflection: null, baseDir: "/tmp" });
  assert.match(plan, /escape the apostrophe/);

  // created exactly one conversation, posted the goal, then polled messages
  assert.equal(calls.filter((c) => c.method === "POST" && c.path === "/api/conversations").length, 1);
  assert.ok(calls.some((c) => c.method === "POST" && c.path.endsWith("/message")));
  assert.ok(calls.some((c) => c.method === "GET" && c.path.endsWith("/messages")));

  // second fetch reuses the same conversation (no new POST /api/conversations)
  await src.fetchPlan({ goal: "again", project: undefined, reflection: "last failure X", baseDir: "/tmp" });
  assert.equal(calls.filter((c) => c.path === "/api/conversations" && c.method === "POST").length, 1);
});

test("HttpArchonPlanSource: surfaces non-OK responses", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => ({}) });
  const src = new HttpArchonPlanSource({ baseUrl: "http://localhost:3737" });
  await assert.rejects(() => src.fetchPlan({ goal: "g", project: undefined, reflection: null, baseDir: "/tmp" }), /502/);
});
