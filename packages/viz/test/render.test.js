import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@loop/parser";
import { renderHtml } from "../dist/index.js";

test("renders a self-contained HTML document with embedded spec + svg", () => {
  const file = parse('loop "fix add":\n  goal: add returns the sum\n  done when "npm test" passes\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again');
  const html = renderHtml(file, { title: "fix.loop" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<svg/);
  assert.match(html, /var SPEC = \{/, "spec embedded");
  assert.match(html, /reflect/, "back-edge label present");
  assert.match(html, /Space\+Mono/, "fonts linked");
});

test("escapes </script> in spec content so it cannot break the inline script", () => {
  const file = parse('loop "x":\n  goal: pwn </script><img src=x onerror=alert(1)>\n  each cycle: plan, then act, then observe');
  const html = renderHtml(file, { title: "x" });
  // the raw closing tag must not appear inside the embedded data
  assert.ok(!html.includes("</script><img"), "no literal </script> breakout");
  assert.match(html, /\\u003c\/script>/, "angle bracket escaped to \\u003c in the embed");
});

test("pipeline renders one section per stage", () => {
  const src = [
    'pipeline "epic: checkout":',
    '  stage "story: cart":',
    "    goal: cart totals",
    '    done when "pnpm test" passes',
    "    each cycle: plan, then act, then observe",
    '  stage "story: pay":',
    "    goal: payment captured",
    "    a human approves before charging the card",
    '    done when "pnpm test" passes',
    "    each cycle: act, then observe",
  ].join("\n");
  const html = renderHtml(parse(src));
  assert.match(html, /epic: checkout/);
  assert.match(html, /story: cart/);
  assert.match(html, /story: pay/);
  assert.match(html, /gate/, "stage gate rendered");
});
