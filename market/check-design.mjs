// design.loop's done-when: market/design.md must carry a Decision + Rationale
// for every UI/UX axis the loop names.
import { readFileSync } from "node:fs";

const AXES = ["layout", "card", "discovery", "detail view", "copy action", "submit", "states", "brand", "a11y"];
const md = readFileSync(new URL("./design.md", import.meta.url), "utf8");

let failed = 0;
for (const axis of AXES) {
  const section = md.split(new RegExp(`^## ${axis}$`, "m"))[1]?.split(/^## /m)[0] ?? "";
  if (!/\*\*Decision:\*\*/.test(section)) { console.error(`✗ ${axis}: no Decision`); failed++; }
  if (!/\*\*Rationale:\*\*/.test(section)) { console.error(`✗ ${axis}: no Rationale`); failed++; }
}
if (failed) process.exit(1);
console.log(`✓ design.md — a decision and rationale for all ${AXES.length} axes`);
