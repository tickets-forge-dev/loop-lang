import { test } from "node:test";
import assert from "node:assert/strict";
import { enumerateItems } from "../dist/index.js";

test("yaml root sequence → one chunk per item", () => {
  const out = enumerateItems("- a\n- b\n- c\n", "yaml");
  assert.equal(out.length, 3);
  assert.match(out[0], /- a/);
});

test("yaml list under a key, multi-line items", () => {
  const src = "stories:\n  - name: login\n    ac: user logs in\n  - name: signup\n    ac: new user\n";
  const out = enumerateItems(src, "yaml");
  assert.equal(out.length, 2);
  assert.match(out[0], /name: login/);
  assert.match(out[0], /ac: user logs in/);
  assert.match(out[1], /name: signup/);
});

test("md → one chunk per ## section, content before first ## ignored", () => {
  const src = "# Plan\nintro text\n## Login\nAC: logs in\n## Signup\nAC: signs up\n";
  const out = enumerateItems(src, "md");
  assert.equal(out.length, 2);
  assert.match(out[0], /## Login/);
  assert.match(out[0], /AC: logs in/);
  assert.doesNotMatch(out[0], /intro text/);
});

test("empty text → []", () => {
  assert.deepEqual(enumerateItems("", "yaml"), []);
  assert.deepEqual(enumerateItems("\n\n", "md"), []);
});

test("yaml with no list → throws", () => {
  assert.throws(() => enumerateItems("foo: bar\nbaz: qux\n", "yaml"), /no list to iterate/);
});
