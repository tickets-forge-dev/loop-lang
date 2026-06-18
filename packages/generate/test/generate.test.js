import { test } from "node:test";
import assert from "node:assert/strict";
import { generateLoop } from "../dist/index.js";

const VALID = `loop "fix add":
  goal: the add function returns the sum
  done when "npm test" passes
  each cycle: plan, then act, then observe
  when it fails: reflect, then plan again`;

const INVALID = `loop "fix add":
  goal: the add function returns the sum
  done when something nonsensical`;

test("one-shot: valid output parses and returns the spec", async () => {
  const calls = [];
  const backend = async (prompt) => {
    calls.push(prompt);
    return VALID;
  };
  const { source, spec, attempts } = await generateLoop("fix the add bug", { backend });
  assert.equal(attempts, 1);
  assert.equal(spec.definitions.length, 1);
  assert.equal(spec.definitions[0].name, "fix add");
  assert.equal(calls.length, 1);
});

test("self-repair: invalid then valid -> error fed back, succeeds on attempt 2", async () => {
  const prompts = [];
  let n = 0;
  const backend = async (prompt) => {
    prompts.push(prompt);
    return n++ === 0 ? INVALID : VALID;
  };
  const { attempts, spec } = await generateLoop("fix the add bug", { backend });
  assert.equal(attempts, 2);
  assert.equal(spec.definitions[0].kind, "loop");
  // the second prompt must contain the parse error so the model can self-correct
  assert.match(prompts[1], /did NOT parse/);
  assert.match(prompts[1], /done when/); // the offending line referenced in the error
});

test("strips markdown fences the model may add", async () => {
  const backend = async () => "```loop\n" + VALID + "\n```";
  const { spec } = await generateLoop("x", { backend });
  assert.equal(spec.definitions[0].name, "fix add");
});

test("gives up after maxAttempts with a clear error", async () => {
  const backend = async () => INVALID;
  await assert.rejects(
    () => generateLoop("x", { backend, maxAttempts: 2 }),
    /could not generate a valid .loop after 2 attempts/
  );
});

test("generates a pipeline for an epic-with-stories request", async () => {
  const PIPE = `pipeline "epic: checkout":
  stage "story: cart":
    goal: cart totals are correct
    done when "pnpm test cart" passes
    each cycle: plan, then act, then observe
  stage "story: pay":
    goal: payment captured
    a human approves before charging the card
    done when "pnpm test pay" passes`;
  const { spec } = await generateLoop("checkout epic with a cart story and a payment story", { backend: async () => PIPE });
  const pipe = spec.definitions[0];
  assert.equal(pipe.kind, "pipeline");
  assert.deepEqual(pipe.stages.map((s) => s.name), ["story: cart", "story: pay"]);
  assert.ok(pipe.stages[1].gate, "risky payment story got a human gate");
});
