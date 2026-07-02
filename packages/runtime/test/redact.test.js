import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRedactor, redactEvent } from "../dist/redact.js";
import { redactingSink } from "../dist/eventSink.js";

test("env layer: values of secret-named env vars are scrubbed and labelled", () => {
  const redact = buildRedactor({
    GITHUB_TOKEN: "supersecret-value-123",
    DB_PASSWORD: "hunter2hunter2",
    PUBLIC_HOME: "public-info-here",  // name doesn't look secret → untouched
    SHORT_TOKEN: "abc",               // too short → untouched (would shred output)
  });
  const out = redact("push failed: auth supersecret-value-123 rejected; db=hunter2hunter2; abc public-info-here");
  assert.ok(!out.includes("supersecret-value-123"));
  assert.ok(!out.includes("hunter2hunter2"));
  assert.match(out, /\[redacted:GITHUB_TOKEN\]/);
  assert.match(out, /\[redacted:DB_PASSWORD\]/);
  assert.ok(out.includes("public-info-here"), "non-secret env value untouched");
  assert.ok(out.includes("abc"), "short value untouched");
});

test("pattern layer: well-known credential shapes are scrubbed", () => {
  const redact = buildRedactor({});
  // Fixtures are assembled at runtime so no literal token shape exists in this source file —
  // otherwise GitHub push protection (correctly!) refuses to let the test suite be pushed.
  const j = (...parts) => parts.join("");
  const cases = [
    [j("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"), "github-token"],
    [j("github_pat_", "11ABCDEFG0123456789_abcdefghij"), "github-token"],
    [j("xoxb-", "123456789012-abcdefghijklmnop"), "slack-token"],
    [j("AKIA", "IOSFODNN7EXAMPLE"), "aws-key-id"],
    [j("sk-", "abcdefghijklmnopqrstuvwxyz123456"), "api-key"],
    [j("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0In0", ".", "SflKxwRJSMeKKF2QT4fwpM"), "jwt"],
  ];
  for (const [secret, label] of cases) {
    const out = redact(`before ${secret} after`);
    assert.ok(!out.includes(secret), `${label}: value scrubbed`);
    assert.match(out, new RegExp(`\\[redacted:${label}\\]`));
    assert.ok(out.startsWith("before ") && out.endsWith(" after"), `${label}: surroundings intact`);
  }
});

test("pattern layer: assignments and auth headers keep the key, lose the value", () => {
  const redact = buildRedactor({});
  assert.equal(redact("password=hunter2!x"), "password=[redacted]");
  assert.equal(redact('api_key: "abcd1234efgh"'), "api_key: [redacted]");
  const bearer = redact("Authorization: Bearer abcdefghijklmnop.qrstuvwxyz-12345");
  assert.ok(!bearer.includes("abcdefghijklmnop"), "bearer token scrubbed");
  assert.match(bearer, /Bearer \[redacted\]/);
});

test("PEM private keys are scrubbed whole (multi-line)", () => {
  const redact = buildRedactor({});
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...lines...\n-----END RSA PRIVATE KEY-----";
  assert.equal(redact(`key:\n${pem}\ndone`), "key:\n[redacted:private-key]\ndone");
});

test("redactEvent walks nested fields and arrays, leaves non-strings alone", () => {
  const redact = buildRedactor({ MY_SECRET_TOKEN: "deadbeefcafe1234" });
  const e = redactEvent(
    { type: "observe", passed: false, output: "err deadbeefcafe1234", extra: { arr: ["x deadbeefcafe1234"] } },
    redact
  );
  assert.equal(e.passed, false, "boolean untouched");
  assert.match(e.output, /\[redacted:MY_SECRET_TOKEN\]/);
  assert.match(e.extra.arr[0], /\[redacted:MY_SECRET_TOKEN\]/);
});

test("redactingSink scrubs before the inner sink sees the event", async () => {
  const seen = [];
  const inner = { post: (e) => seen.push(e), flush: async () => {} };
  const sink = redactingSink(inner, buildRedactor({ CI_TOKEN: "0123456789abcdef" }));
  sink.post({ type: "observe", passed: true, output: "ok 0123456789abcdef" });
  await sink.flush();
  assert.equal(seen.length, 1);
  assert.ok(!JSON.stringify(seen[0]).includes("0123456789abcdef"), "raw secret never reached the sink");
});
