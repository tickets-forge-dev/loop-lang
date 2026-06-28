import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

// packages/cli — cross-platform (URL.pathname yields "/C:/…" on Windows; fileURLToPath fixes it)
const pkgDir = fileURLToPath(new URL("..", import.meta.url));

test("loop version prints expected string", () => {
  const out = execFileSync(process.execPath, ["src/cli.mjs", "version"], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  assert.equal(out.trim(), `@loop-lang/loop v${version}`);
});

test("loop --version also works", () => {
  const out = execFileSync(process.execPath, ["src/cli.mjs", "--version"], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  assert.equal(out.trim(), `@loop-lang/loop v${version}`);
});
