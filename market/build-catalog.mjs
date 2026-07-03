// Build docs/market/catalog.json from marketplace/loops/*.loop.
// The validator gates entry: a loop that fails the bar never reaches the catalog —
// which is why the market UI needs no "broken loop" state (design.md → states).
// Metadata (category/author/source/concept) joins from market/curated.yaml by slug;
// loops not in curated.yaml (future submissions) fall back to their attribution header.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "@loop-lang/parser";

// 1. the bar
execFileSync("node", [new URL("./validate-marketplace.mjs", import.meta.url).pathname], { stdio: "inherit" });

// 2. curated metadata by slug
const curated = {};
{
  const text = readFileSync(new URL("./curated.yaml", import.meta.url), "utf8");
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^  - slug: (.+)$/);
    if (m) { cur = { slug: m[1].trim() }; curated[cur.slug] = cur; continue; }
    const kv = line.match(/^    (\w+): "?(.*?)"?$/);
    if (kv && cur) cur[kv[1]] = kv[2];
  }
}

const GLYPH = { loop: "↻", pipeline: "▶", flow: "→" };
const dir = new URL("../marketplace/loops/", import.meta.url).pathname;
const entries = [];

for (const f of readdirSync(dir).filter((x) => x.endsWith(".loop")).sort()) {
  const src = readFileSync(join(dir, f), "utf8");
  const slug = f.replace(/\.loop$/, "");
  const spec = parse(src);
  const def = spec.definitions[0];
  const loop = def.kind === "pipeline" ? def.stages[0].loop : def;

  // first machine-checkable predicate, reconstructed as display text
  const pred = (loop.doneWhen ?? []).find((p) => p.type !== "human");
  let doneWhen = "";
  if (pred?.type === "test") doneWhen = `the test "${pred.target}" passes${pred.runs > 1 ? ` ${pred.runs} times` : ""}`;
  else if (pred?.type === "command") doneWhen = `"${pred.command}" ${pred.expect === "empty" ? "finds nothing" : "passes"}${pred.runs > 1 ? ` ${pred.runs} times` : ""}`;
  else if (pred?.type === "skill") doneWhen = `the skill "${pred.skill}" ${pred.minScore ? `scores ${pred.minScore}+` : "approves"}${pred.judges > 1 ? ` by ${pred.judges} judges` : ""}`;

  const meta = curated[slug] ?? {};
  const header = src.match(/^# concept via (.+?) — (https:\/\/\S+)/m);
  entries.push({
    slug,
    title: def.name ?? slug,
    shape: def.kind,
    glyph: GLYPH[def.kind] ?? "↻",
    goal: loop.goal ?? "",
    doneWhen,
    category: meta.category ?? "engineering",
    author: meta.author ?? header?.[1] ?? "community",
    source: meta.source ?? header?.[2] ?? "",
    concept: meta.concept ?? "",
    keywords: [slug.replace(/-/g, " "), meta.category ?? "", def.kind].join(" "),
    text: src,
  });
}

const outDir = new URL("../docs/market/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "catalog.json"), JSON.stringify({ built: "loop-market", count: entries.length, entries }, null, 1));
console.log(`✓ catalog.json — ${entries.length} loops`);
