const isBlank = (s: string): boolean => s.trim() === "" || s.trim().startsWith("#");
const indentOf = (s: string): number => s.length - s.trimStart().length;

export function enumerateItems(text: string, format: "yaml" | "yml" | "md"): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return format === "md" ? chunkMarkdown(lines) : chunkYaml(lines);
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
