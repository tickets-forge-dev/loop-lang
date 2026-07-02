import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ShellVerifier } from "../dist/verify.js";

const verifier = new ShellVerifier();

// A shell snippet that appends one line to `f` (so the file's line count == how many times the
// command actually ran), optionally then exiting non-zero to simulate a failing run.
const bump = (f, ok = true) => `echo x >> ${JSON.stringify(f)}${ok ? "" : "; exit 1"}`;
const runCount = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).length : 0);

test("a single-run command still runs exactly once and passes on exit 0", async () => {
  const f = join(tmpdir(), `verify-once-${process.pid}-${Date.now()}`);
  try {
    const r = await verifier.verify({ type: "command", command: bump(f), expect: "exit-zero" }, tmpdir());
    assert.equal(r.passed, true);
    assert.equal(runCount(f), 1);
    assert.ok(!/passed \d+\/\d+ runs/.test(r.output), "no flake-guard suffix for a single run");
  } finally {
    rmSync(f, { force: true });
  }
});

test("`passes N times` runs the command N times when every run passes", async () => {
  const f = join(tmpdir(), `verify-ntimes-${process.pid}-${Date.now()}`);
  try {
    const r = await verifier.verify({ type: "command", command: bump(f), expect: "exit-zero", runs: 4 }, tmpdir());
    assert.equal(r.passed, true);
    assert.equal(runCount(f), 4, "ran exactly 4 times");
    assert.match(r.output, /passed 4\/4 runs/);
  } finally {
    rmSync(f, { force: true });
  }
});

test("`passes N times` short-circuits on the first failing run", async () => {
  const f = join(tmpdir(), `verify-shortcircuit-${process.pid}-${Date.now()}`);
  try {
    // Always appends, then exits 1 → the first run fails, so the remaining runs must NOT execute.
    const r = await verifier.verify({ type: "command", command: bump(f, false), expect: "exit-zero", runs: 3 }, tmpdir());
    assert.equal(r.passed, false);
    assert.equal(runCount(f), 1, "stopped after the first failure — did not run 3 times");
    assert.match(r.output, /run 1\/3 failed/);
  } finally {
    rmSync(f, { force: true });
  }
});

test("`finds nothing N times` requires empty output on every run", async () => {
  // `true` produces no output and exits 0 → empty, so N clean runs pass.
  const clean = await verifier.verify({ type: "command", command: "true", expect: "empty", runs: 3 }, tmpdir());
  assert.equal(clean.passed, true);
  assert.match(clean.output, /passed 3\/3 runs/);

  // A command that prints has non-empty output → fails on the first run.
  const noisy = await verifier.verify({ type: "command", command: "echo found-a-match", expect: "empty", runs: 3 }, tmpdir());
  assert.equal(noisy.passed, false);
  assert.match(noisy.output, /run 1\/3 failed/);
});
