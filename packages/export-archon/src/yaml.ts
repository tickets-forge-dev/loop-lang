/**
 * A small YAML emitter for the exact shapes we produce (maps, string arrays,
 * arrays of nodes, multiline strings). Not a general-purpose serializer — it
 * covers what `compile.ts` emits, and the output is validated against the `yaml`
 * parser in tests. Kept dependency-free so the package ships with zero runtime deps.
 */

type Scalar = string | number | boolean;
type Value = Scalar | Value[] | { [k: string]: Value | undefined };

const INDENT = "  ";

function needsQuote(s: string): boolean {
  if (s === "") return true;
  if (/^[\s]|[\s]$/.test(s)) return true; // leading/trailing space
  // characters that are significant in YAML flow/plain scalars
  if (/[:#\[\]{}&*!|>'"%@`,]/.test(s)) return true;
  if (/^[-?]/.test(s)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
  if (/^[+-]?(\d|\.\d)/.test(s)) return true; // looks numeric
  return false;
}

function emitScalar(v: Scalar): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (needsQuote(v)) return JSON.stringify(v); // double-quoted, valid YAML
  return v;
}

/** Render a multiline string as a block scalar (`|`) at the given indent. */
function emitBlock(value: string, indent: number): string {
  const pad = INDENT.repeat(indent + 1);
  const body = value
    .replace(/\n+$/, "") // trailing blank lines confuse `|`; keep one via clip
    .split("\n")
    .map((line) => (line.length ? pad + line : ""))
    .join("\n");
  return "|\n" + body;
}

function isMultiline(v: Value): v is string {
  return typeof v === "string" && v.includes("\n");
}

function emitValue(value: Value, indent: number): string {
  if (Array.isArray(value)) return emitArray(value, indent);
  if (value !== null && typeof value === "object") return "\n" + emitMap(value as Record<string, Value>, indent + 1);
  if (isMultiline(value)) return emitBlock(value, indent);
  return emitScalar(value as Scalar);
}

function emitArray(arr: Value[], indent: number): string {
  if (arr.length === 0) return "[]";
  // Array of scalars -> flow style on one line.
  if (arr.every((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean")) {
    return "[" + arr.map((x) => emitScalar(x as Scalar)).join(", ") + "]";
  }
  // Array of maps -> block list.
  const pad = INDENT.repeat(indent);
  return (
    "\n" +
    arr
      .map((item) => {
        const map = emitMap(item as Record<string, Value>, indent + 1);
        // splice "- " into the first rendered line
        const firstLineStart = INDENT.repeat(indent + 1);
        return pad + "- " + map.slice(firstLineStart.length);
      })
      .join("\n")
  );
}

function emitMap(obj: Record<string, Value | undefined>, indent: number): string {
  const pad = INDENT.repeat(indent);
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    if (raw === undefined) continue;
    const rendered = emitValue(raw as Value, indent);
    // Block values (nested maps / object-arrays) start with a newline — no space after the colon.
    const sep = rendered.startsWith("\n") ? "" : " ";
    lines.push(`${pad}${key}:${sep}${rendered}`);
  }
  return lines.join("\n");
}

export function toYaml(obj: Record<string, Value | undefined>): string {
  return emitMap(obj, 0) + "\n";
}
