// Validates market/curated.yaml — the curate stage's done-when.
// 20–30 entries; every entry carries slug/title/category/author/source/concept/verify_as;
// slugs unique; categories from the known set; source URLs well-formed.
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("./curated.yaml", import.meta.url), "utf8");
const entries = [];
let cur = null;
for (const line of text.split("\n")) {
  const m = line.match(/^  - slug: (.+)$/);
  if (m) { cur = { slug: m[1].trim() }; entries.push(cur); continue; }
  const kv = line.match(/^    (\w+): "?(.*?)"?$/);
  if (kv && cur) cur[kv[1]] = kv[2];
}

const REQUIRED = ["slug", "title", "category", "author", "source", "concept", "verify_as"];
const CATS = new Set(["engineering", "evaluation", "operations", "content", "design"]);
const fail = (msg) => { console.error("✗ " + msg); process.exitCode = 1; };

if (entries.length < 20 || entries.length > 30) fail(`expected 20–30 entries, found ${entries.length}`);
const seen = new Set();
for (const e of entries) {
  for (const k of REQUIRED) if (!e[k]) fail(`${e.slug ?? "?"}: missing ${k}`);
  if (seen.has(e.slug)) fail(`duplicate slug ${e.slug}`);
  seen.add(e.slug);
  if (e.category && !CATS.has(e.category)) fail(`${e.slug}: unknown category ${e.category}`);
  if (e.source && !/^https:\/\//.test(e.source)) fail(`${e.slug}: source is not an https URL`);
}
if (process.exitCode) process.exit(1);
console.log(`✓ curated.yaml valid — ${entries.length} entries, all attributed`);
