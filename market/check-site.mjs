// site.loop's done-when (second half): the catalog artifact and the gallery page
// are complete and consistent.
import { readFileSync } from "node:fs";
import { parse } from "@loop-lang/parser";

const fail = (m) => { console.error("✗ " + m); process.exitCode = 1; };

let cat;
try { cat = JSON.parse(readFileSync(new URL("../docs/market/catalog.json", import.meta.url), "utf8")); }
catch { fail("docs/market/catalog.json missing or invalid"); process.exit(1); }

if (cat.count < 20) fail(`catalog has ${cat.count} loops — expected ≥ 20`);
for (const e of cat.entries) {
  for (const k of ["slug", "title", "goal", "doneWhen", "category", "author", "text"]) {
    if (!e[k]) fail(`${e.slug ?? "?"}: missing ${k}`);
  }
  try { parse(e.text); } catch (err) { fail(`${e.slug}: embedded source no longer parses — ${err.message}`); }
}

const html = readFileSync(new URL("../docs/market/index.html", import.meta.url), "utf8");
for (const [needle, why] of [
  ['id="q"', "search input"],
  ['id="chips"', "category chips"],
  ["Submit your loop", "submit CTA"],
  ["catalog.json", "catalog fetch"],
  ["aria-pressed", "a11y chips"],
  ["CONTRIBUTING.md", "the bar link"],
]) if (!html.includes(needle)) fail(`market page missing ${why}`);

if (process.exitCode) process.exit(1);
console.log(`✓ market site — catalog ${cat.count} loops, page carries search/chips/submit/a11y hooks`);
