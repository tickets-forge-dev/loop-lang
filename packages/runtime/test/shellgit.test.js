import { test } from "node:test";
import assert from "node:assert/strict";
import { ShellGitIO } from "../dist/index.js";

test("ShellGitIO.push rejects protected branch 'main' before shelling", async () => {
  const git = new ShellGitIO();
  await assert.rejects(
    () => git.push({ branch: "main", dir: "." }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /refusing to push to protected branch/);
      return true;
    }
  );
});

test("ShellGitIO.push rejects protected branch 'master' before shelling", async () => {
  const git = new ShellGitIO();
  await assert.rejects(
    () => git.push({ branch: "master", dir: "." }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /refusing to push to protected branch/);
      return true;
    }
  );
});
