import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeSessionCommand, buildPiSessionCommand, shq } from "../dist/sessionCommand.js";

test("buildClaudeSessionCommand opens loopflow slash command", () => {
  assert.equal(
    buildClaudeSessionCommand({ binary: "claude", targetPath: "/repo/evals.loop" }),
    'claude "/loopflow run /repo/evals.loop"'
  );
});

test("buildPiSessionCommand invokes loopflow as a pi skill", () => {
  assert.equal(
    buildPiSessionCommand({ binary: "pi", targetPath: "/repo/evals.loop" }),
    'pi "/skill:loopflow run /repo/evals.loop"'
  );
});

test("session command builders pass through model flags", () => {
  assert.equal(
    buildPiSessionCommand({ binary: "pi", model: "sonnet:high", targetPath: "/repo/evals.loop" }),
    'pi --model "sonnet:high" "/skill:loopflow run /repo/evals.loop"'
  );
});

test("shq escapes shell-sensitive characters", () => {
  assert.equal(shq('/tmp/a "quoted" $path `cmd`.loop'), '"/tmp/a \\"quoted\\" \\$path \\`cmd\\`.loop"');
});
