import type { LoopEvent } from "./types.js";

/**
 * Secret redaction for telemetry. Loop events carry raw command output (`observe`, `node-exit`,
 * hook details …), and in CI that output can echo tokens from the environment. Everything a sink
 * persists — the local NDJSON log and the HTTP collector — passes through here first, so a leaked
 * credential is scrubbed *before* it ever touches disk or the network.
 *
 * Two layers, both best-effort:
 *  1. **Environment values** — the value of any env var whose NAME looks secret-bearing
 *     (TOKEN / SECRET / PASSWORD / *_KEY / CREDENTIALS / AUTH) is replaced wherever it appears,
 *     labelled with the variable name so the trace stays debuggable.
 *  2. **Well-known shapes** — GitHub / Slack / AWS / generic `sk-` API keys, JWTs, PEM private
 *     keys, `Bearer …` headers, and `password=…`-style assignments.
 *
 * On by default; `LOOP_REDACT=off` disables (e.g. for local debugging of the redactor itself).
 */

const SECRET_ENV_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?|AUTH)/i;

/** Value-shape patterns for common credentials. Order matters: multi-line PEM first. */
const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted:private-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted:github-token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted:github-token]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted:slack-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted:aws-key-id]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted:api-key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted:jwt]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, "$1 [redacted]"],
  // `password=hunter2!`, `api_key: "…"` — keep the key, scrub the value. The lookahead skips
  // values already handled above (`Bearer [redacted]`, an env-layer `[redacted:X]`).
  [/\b(password|passwd|secret|token|api[_-]?key|authorization)(\s*[=:]\s*)(?!\[redacted|Bearer\b|Basic\b)("[^"]{4,}"|'[^']{4,}'|[^\s"']{4,})/gi, "$1$2[redacted]"],
];

/**
 * Build a string redactor from an environment map. Values shorter than 8 chars are ignored —
 * scrubbing something like "true" or "dev" would shred ordinary output.
 */
export function buildRedactor(env: Record<string, string | undefined> = process.env): (s: string) => string {
  const values = Object.entries(env)
    .filter((e): e is [string, string] => !!e[1] && e[1].length >= 8 && SECRET_ENV_NAME.test(e[0]))
    .sort((a, b) => b[1].length - a[1].length); // longest first so substrings can't pre-empt
  return (s: string): string => {
    let out = s;
    for (const [name, value] of values) out = out.split(value).join(`[redacted:${name}]`);
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
    return out;
  };
}

/** Deep-walk an event and redact every string field (arrays and nested objects included). */
export function redactEvent(e: LoopEvent, redact: (s: string) => string): LoopEvent {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redact(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(e) as LoopEvent;
}
