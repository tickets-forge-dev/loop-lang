// The marketplace bar — every loop in marketplace/loops/ must clear it.
// Used as the conversion template's done-when, by CI on submission PRs
// (--with-ci also requires the workflow file), and by the catalog builder.
//
// The bar:
//   1. parses with the real parser
//   2. has a goal
//   3. has at least one done-when — and at least one that is NOT `a human confirms`
//      (machine-checkable: test / command / skill-eval) — the whole point
//   4. self-correcting loops carry a thrash guard (reflect back-edge → after N tries)
//   5. carries an attribution header: `# concept via <author> — <https url>`
//      (or `# original — <author>` for first-party loops)
import { readdirSync, readFileSync, accessSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@loop-lang/parser";

const dir = new URL("../marketplace/loops/", import.meta.url).pathname;
let files = [];
try { files = readdirSync(dir).filter((f) => f.endsWith(".loop")); } catch { /* empty is fine pre-conversion */ }

let failed = 0;
const fail = (f, msg) => { console.error(`✗ ${f}: ${msg}`); failed++; };

for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");

  if (!/^#.*(concept via .+ — https:\/\/|original — )/m.test(src)) {
    fail(f, "missing attribution header (`# concept via <author> — <url>` or `# original — <author>`)");
  }

  let spec;
  try { spec = parse(src); } catch (e) { fail(f, `parse: ${e.message}`); continue; }

  const loops = [];
  for (const def of spec.definitions) {
    if (def.kind === "loop") loops.push(def);
    if (def.kind === "pipeline") loops.push(...def.stages.map((s) => s.loop));
  }
  if (!loops.length) { fail(f, "no loop/pipeline definition"); continue; }

  for (const loop of loops) {
    const name = loop.name ?? f;
    if (!loop.goal) fail(f, `${name}: no goal`);
    const preds = loop.doneWhen ?? [];
    if (!preds.length) { fail(f, `${name}: no done-when`); continue; }
    if (!preds.some((p) => p.type !== "human")) {
      fail(f, `${name}: verification is human-only — needs a machine-checkable done-when`);
    }
    const reflects = (loop.transitions ?? []).some((t) => t.on === "fail" && (t.do ?? []).some((d) => ["reflect", "plan"].includes(d.action)));
    const guarded = (loop.transitions ?? []).some((t) => t.on === "attempts");
    if (reflects && !guarded) fail(f, `${name}: reflect back-edge without an after-N-tries guard`);
  }
}

if (process.argv.includes("--with-ci")) {
  try { accessSync(new URL("../.github/workflows/marketplace.yml", import.meta.url).pathname); }
  catch { fail("marketplace.yml", "CI workflow missing"); }
}

if (failed) { console.error(`${failed} problem(s) across ${files.length} loop(s)`); process.exit(1); }
console.log(`✓ marketplace clean — ${files.length} loop(s) meet the bar`);
