import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@loop-lang/parser";
import { runDefinition, MockRunner, ScriptedHumanIO } from "../dist/index.js";

/** Loop whose only check is a 3-judge eval panel. */
const SRC = [
  'loop "panel":',
  "  goal: the design is sound",
  '  done when the skill "design-review" approves by 3 judges',
  "  each cycle: act, then observe",
  '  after 1 tries: stop and warn "give up"',
].join("\n");

function stubs(verdicts, events) {
  let call = 0;
  return {
    runner: new MockRunner({
      skill: () => {
        const passed = verdicts[Math.min(call, verdicts.length - 1)];
        call++;
        return { passed, detail: passed ? "APPROVED" : "REJECTED" };
      },
    }),
    verifier: { verify: async () => ({ passed: true, output: "unused" }) },
    human: new ScriptedHumanIO(),
    baseDir: "/p",
    hardCap: 2,
    readText: async () => "",
    writeText: async () => {},
    onEvent: (e) => events?.push(e),
  };
}

test("majority approves (2/3) → satisfied; early-exit skips the 3rd judge", async () => {
  const events = [];
  const def = parse(SRC).definitions[0];
  const s = stubs([true, true, false], events);
  const outcome = await runDefinition(def, s);
  assert.equal(outcome.satisfied, true);
  // 2 approvals reach majority of 3 → decided after judge 2; judge 3 never runs.
  assert.equal(s.runner.skillCalls.length, 2, "early-exit once the vote is decided");
  const votes = events.filter((e) => e.type === "skill-verify");
  assert.equal(votes.length, 2);
  assert.match(votes[0].detail, /^judge 1\/3: /);
  const observe = events.find((e) => e.type === "observe");
  assert.match(observe.output, /judges: 2\/2 approved \(majority of 3 reached\)/);
});

test("majority rejects → not satisfied; each cycle's vote decided after 2 rejections", async () => {
  const events = [];
  const def = parse(SRC).definitions[0];
  const s = stubs([false], events); // every judge rejects, every cycle
  const outcome = await runDefinition(def, s);
  assert.equal(outcome.satisfied, false, "panel rejected → loop not done");
  // Majority-to-reject is decided after 2 of 3 rejections → exactly 2 votes per cycle.
  const observes = events.filter((e) => e.type === "observe");
  const votes = events.filter((e) => e.type === "skill-verify");
  assert.equal(votes.length, observes.length * 2, "2 votes per cycle (early-exit on decided rejection)");
  assert.ok(observes.every((o) => o.passed === false));
  assert.match(observes[0].output, /judges: 0\/2 approved \(majority of 3 not reached\)/);
});

test("split then flip: 1 reject + 2 approves → majority approves", async () => {
  const def = parse(SRC).definitions[0];
  const s = stubs([false, true, true]);
  const outcome = await runDefinition(def, s);
  assert.equal(outcome.satisfied, true, "2/3 approvals carry the vote even after a first rejection");
  assert.equal(s.runner.skillCalls.length, 3, "vote undecided until the 3rd judge");
});

test("single judge (no `by N judges`) behaves exactly as before", async () => {
  const src = SRC.replace(" by 3 judges", "");
  const def = parse(src).definitions[0];
  const events = [];
  const s = stubs([true], events);
  const outcome = await runDefinition(def, s);
  assert.equal(outcome.satisfied, true);
  assert.equal(s.runner.skillCalls.length, 1);
  const vote = events.find((e) => e.type === "skill-verify");
  assert.ok(!/^judge \d/.test(vote.detail), "no judge prefix for a single verdict");
});
