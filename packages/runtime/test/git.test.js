import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGit, isProtected } from "../dist/index.js";

test("built-in default: branch + commit-done, no push", () => {
  assert.deepEqual(resolveGit(), { isolation: "branch", branch: undefined, commit: "done", push: false, openPr: false });
});
test("file overrides built-in; per-loop overrides file (commit)", () => {
  const r = resolveGit({ isolation: "worktree", push: true }, { commit: "cycle" });
  assert.equal(r.isolation, "worktree"); assert.equal(r.push, true); assert.equal(r.commit, "cycle");
});
test("dial-down: work in place + commit never", () => {
  const r = resolveGit({ isolation: "in-place", commit: "never" });
  assert.equal(r.isolation, "in-place"); assert.equal(r.commit, "never");
});
test("isProtected covers main and master", () => {
  assert.equal(isProtected("main"), true);
  assert.equal(isProtected("master"), true);
  assert.equal(isProtected("loop/fix-x"), false);
});
