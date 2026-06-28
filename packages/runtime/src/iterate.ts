const isBlank = (s: string): boolean => s.trim() === "" || s.trim().startsWith("#");
const indentOf = (s: string): number => s.length - s.trimStart().length;

export function enumerateItems(text: string, format: "yaml" | "yml" | "md"): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return format === "md" ? chunkMarkdown(lines) : chunkYaml(lines);
}

/** Strip one balanced pair of surrounding quotes (not a lone leading/trailing one). */
const stripQuotes = (s: string): string =>
  s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0] ? s.slice(1, -1) : s;

/** Truncate to 80 chars without splitting a surrogate pair. */
const clip = (s: string): string => Array.from(s).slice(0, 80).join("");

/** A bare YAML block-scalar indicator (`|`, `>`, with optional chomp/indent) — not a value. */
const isBlockIndicator = (v: string): boolean => /^[|>][0-9+-]*$/.test(v);

/** A short human label for one enumerated item — for the live dashboard's item list.
 *  Markdown: the `## ` heading. YAML: the first of title/name/story/summary (following a
 *  block scalar to its body), else the first scalar value, else the first line. Truncated. */
export function labelOf(item: string): string {
  const raw = item.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (raw.length === 0) return "";
  const heading = raw[0].match(/^#{2,}\s+(.*)$/); // markdown `## ` section title (2+ #; single # is a YAML comment)
  if (heading) return clip(heading[1].trim());
  const lines = raw.filter((l) => !l.startsWith("#")); // drop YAML comments
  if (lines.length === 0) return "";
  for (const key of ["title", "name", "story", "summary"]) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].replace(/^-\s+/, "").match(new RegExp(`^${key}:\\s*(.*)$`, "i"));
      if (!m) continue;
      const v = stripQuotes(m[1].trim());
      if (v && !isBlockIndicator(v)) return clip(v);
      // inline value was empty or a block scalar (`|`/`>`) → use the first body line below it
      for (let j = i + 1; j < lines.length; j++) {
        const body = lines[j].replace(/^-\s+/, "").trim();
        if (body && !/^[\w.-]+:\s/.test(body)) return clip(stripQuotes(body));
      }
    }
  }
  let first = lines[0].replace(/^-\s+/, "");
  const kv = first.match(/^[\w.-]+:\s+(.+)$/); // require space after ':' so URLs/times (https://, 09:00) stay intact
  if (kv) first = kv[1];
  return clip(stripQuotes(first.trim()));
}

function chunkMarkdown(lines: string[]): string[] {
  const chunks: string[] = [];
  let cur: string[] | null = null;
  for (const ln of lines) {
    if (/^##\s+/.test(ln)) {
      if (cur) chunks.push(cur.join("\n").trim());
      cur = [ln];
    } else if (cur) {
      cur.push(ln);
    }
  }
  if (cur) chunks.push(cur.join("\n").trim());
  return chunks.filter((c) => c.length > 0);
}

function chunkYaml(lines: string[]): string[] {
  let listIndent = -1;
  let startIdx = -1;

  // root sequence? (decided by the first content line)
  for (let i = 0; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    if (/^-\s+/.test(lines[i])) { listIndent = 0; startIdx = i; }
    break;
  }

  // else: first top-level "key:" whose next content line is a deeper "- "
  if (startIdx === -1) {
    for (let i = 0; i < lines.length && startIdx === -1; i++) {
      if (isBlank(lines[i])) continue;
      if (indentOf(lines[i]) !== 0 || !/^[\w.-]+:\s*$/.test(lines[i].trim())) continue;
      for (let j = i + 1; j < lines.length; j++) {
        if (isBlank(lines[j])) continue;
        const ind = indentOf(lines[j]);
        if (ind > 0 && /^-\s+/.test(lines[j].trimStart())) { listIndent = ind; startIdx = j; }
        break; // only the first content line under the key decides
      }
    }
  }

  if (startIdx === -1) {
    if (lines.every(isBlank)) return [];
    throw new Error("for each: source YAML has no list to iterate (expected a sequence of `- items`).");
  }

  const chunks: string[] = [];
  let cur: string[] | null = null;
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i];
    if (isBlank(ln)) { if (cur) cur.push(ln); continue; }
    const ind = indentOf(ln);
    if (ind < listIndent) break; // dedent ends the list
    const isItem = ind === listIndent && /^-\s+/.test(ln.trimStart());
    if (ind === listIndent && !isItem) break; // a non-item line at the item indent ends the list
    if (isItem) {
      if (cur) chunks.push(cur.join("\n").trim());
      cur = [ln];
    } else if (cur) {
      cur.push(ln); // deeper line → continuation of the current item
    }
  }
  if (cur) chunks.push(cur.join("\n").trim());
  return chunks.filter((c) => c.length > 0);
}
