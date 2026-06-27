import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

test("loop version prints expected string", () => {
  const out = execFileSync(process.execPath, ["src/cli.mjs", "version"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  assert.equal(out.trim(), `@loop-lang/loop v${version}`);
});

test("loop --version also works", () => {
  const out = execFileSync(process.execPath, ["src/cli.mjs", "--version"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  assert.equal(out.trim(), `@loop-lang/loop v${version}`);
});
