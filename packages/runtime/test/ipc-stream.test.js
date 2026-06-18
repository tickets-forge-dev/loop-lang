import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretStreamLine, IpcHumanIO } from "../dist/index.js";

test("interpretStreamLine: assistant text becomes activity", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "  Looking at the form  " }] } });
  assert.deepEqual(interpretStreamLine(line), { activities: ["Looking at the form"] });
});

test("interpretStreamLine: tool_use surfaces its input (command, diff)", () => {
  const edit = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/auth/login.ts", old_string: "return a - b", new_string: "return a + b" } }] } });
  assert.deepEqual(interpretStreamLine(edit).activities, ["● Edit login.ts", "   - return a - b", "   + return a + b"]);
  const bash = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } });
  assert.deepEqual(interpretStreamLine(bash).activities, ["● Bash", "   $ npm test"]);
});

test("interpretStreamLine: thinking and tool results are surfaced", () => {
  const think = JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "the bug is the operator" }] } });
  assert.deepEqual(interpretStreamLine(think).activities, ["💭 the bug is the operator"]);
  const result = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "line1\nline2\nline3\nline4" }] } });
  assert.deepEqual(interpretStreamLine(result).activities, ["  ⤷ line1", "  ⤷ line2", "  ⤷ line3"]);
});

test("interpretStreamLine: result line yields the final text", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", result: "done" });
  assert.deepEqual(interpretStreamLine(line), { activities: [], result: "done" });
});

test("interpretStreamLine: system + malformed lines are inert", () => {
  assert.deepEqual(interpretStreamLine(JSON.stringify({ type: "system", subtype: "init" })), { activities: [] });
  assert.deepEqual(interpretStreamLine("not json"), { activities: [] });
  assert.deepEqual(interpretStreamLine("  "), { activities: [] });
});

test("IpcHumanIO: emits a request and resolves on the matching id", async () => {
  const emitted = [];
  const ipc = new IpcHumanIO((req) => emitted.push(req));
  const p = ipc.plan("approve the plan for X");
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], { kind: "ask", id: 1, human: "plan", prompt: "approve the plan for X" });
  ipc.resolve(1, true);
  assert.equal(await p, true);
});

test("IpcHumanIO: independent ids, denial, and ask() returns void", async () => {
  const emitted = [];
  const ipc = new IpcHumanIO((req) => emitted.push(req));
  const confirm = ipc.confirm("push");
  const review = ipc.review("looks right?");
  assert.deepEqual(emitted.map((e) => [e.id, e.human]), [[1, "confirm"], [2, "review"]]);
  ipc.resolve(2, true);
  ipc.resolve(1, false);
  assert.equal(await confirm, false);
  assert.equal(await review, true);

  const ask = ipc.ask("unblock me");
  ipc.resolve(3, true);
  assert.equal(await ask, undefined);
});

test("IpcHumanIO: unknown ids are ignored (no throw)", () => {
  const ipc = new IpcHumanIO(() => {});
  assert.doesNotThrow(() => ipc.resolve(999, true));
});
