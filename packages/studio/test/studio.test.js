import { test } from "node:test";
import assert from "node:assert/strict";
import { handleParse, editorHtml } from "../dist/index.js";

test("handleParse: valid source returns the spec", () => {
  const res = handleParse('loop "x":\n  goal: y\n  done when "npm test" passes\n  each cycle: plan, then act, then observe');
  assert.equal(res.ok, true);
  assert.equal(res.spec.definitions[0].name, "x");
});

test("handleParse: invalid source returns error + line", () => {
  const res = handleParse('loop "x":\n  goal: y\n  done when gibberish');
  assert.equal(res.ok, false);
  assert.equal(res.line, 3);
  assert.match(res.error, /done when/);
});

test("editorHtml: a self-contained 3-pane document wired to the IR", () => {
  const html = editorHtml();
  assert.match(html, /id="editor"/, "the .loop textarea");
  assert.match(html, /id="graph"/, "the graph pane");
  assert.match(html, /id="chatform"/, "the chat pane");
  assert.match(html, /id="run"/, "the run button");
  assert.match(html, /LoopViz=\(function/, "the shared renderer is embedded");
  assert.match(html, /\/api\/parse/, "live parse binding");
  assert.match(html, /\/api\/generate/, "chat generate binding");
  assert.match(html, /\/api\/run/, "run streaming binding");
});
