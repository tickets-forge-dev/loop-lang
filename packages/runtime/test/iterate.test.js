import { test } from "node:test";
import assert from "node:assert/strict";
import { enumerateItems, labelOf } from "../dist/index.js";

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

test("yaml root seq with a trailing non-list key does not glue onto the last item", () => {
  const out = enumerateItems("- a\n- b\nmetadata: x\n", "yaml");
  assert.equal(out.length, 2);
  assert.doesNotMatch(out[1], /metadata/);
});

test("yaml key-list ends before a sibling key", () => {
  const out = enumerateItems("stories:\n  - a\n  - b\nmeta: x\n", "yaml");
  assert.equal(out.length, 2);
  assert.doesNotMatch(out[1], /meta/);
});

test("yaml 'yml' alias enumerates like yaml", () => {
  assert.equal(enumerateItems("- x\n- y\n", "yml").length, 2);
});

test("labelOf: yaml prefers title:, then name:, else first scalar", () => {
  assert.equal(labelOf("- epic: Auth\n  title: User can log in\n  ac: x"), "User can log in");
  assert.equal(labelOf("- name: Build the thing\n  x: 1"), "Build the thing");
  assert.equal(labelOf("- just a bare value"), "just a bare value");
  assert.equal(labelOf('- title: "quoted wins"'), "quoted wins");
});

test("labelOf: markdown uses the ## heading (not the comment-filter casualty)", () => {
  assert.equal(labelOf("## First task\nblah"), "First task");
  assert.equal(labelOf("### Deeper\nbody"), "Deeper");
});

test("labelOf: skips YAML comments, empty → ''", () => {
  assert.equal(labelOf("# a comment\n- name: real"), "real");
  assert.equal(labelOf(""), "");
});

test("labelOf: a block scalar (| or >) follows to its body line", () => {
  assert.equal(labelOf("- story: |\n    As a user I log in\n    more"), "As a user I log in");
  assert.equal(labelOf("- summary: >\n    folded text here"), "folded text here");
});

test("labelOf: a colon inside a bare scalar is not mistaken for a key", () => {
  assert.equal(labelOf("- https://example.com/path"), "https://example.com/path");
  assert.equal(labelOf("- 09:00 standup with team"), "09:00 standup with team");
});

test("labelOf: only strips a balanced quote pair", () => {
  assert.equal(labelOf('- name: say "hi"'), 'say "hi"');
  assert.equal(labelOf("- title: 'wrapped'"), "wrapped");
});

test("enumerate + labelOf together on a story list", () => {
  const src = "stories:\n  - title: Login\n    ac: a\n  - title: Signup\n    ac: b\n";
  assert.deepEqual(enumerateItems(src, "yaml").map(labelOf), ["Login", "Signup"]);
});
