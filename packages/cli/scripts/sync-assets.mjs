// Copy the source-of-truth assets from the repo root into this package's assets/
// dir so the published package is self-contained (npx fetches only this package).
// Runs on prepack and before tests. Repo root = ../../ from packages/cli.
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const root = join(pkg, "..", "..");
const assets = join(pkg, "assets");

const COPIES = [
  [join(root, "AGENTS.md"), join(assets, "AGENTS.md")],
  [join(root, ".claude", "skills", "loop"), join(assets, "skill")],
  [join(root, "examples", "fix_test.loop"), join(assets, "examples", "fix_test.loop")],
];

await rm(assets, { recursive: true, force: true });
await mkdir(join(assets, "examples"), { recursive: true });
let n = 0;
for (const [src, dst] of COPIES) {
  if (!existsSync(src)) { console.error(`sync-assets: missing ${src}`); process.exit(1); }
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { recursive: true });
  n++;
}
console.log(`sync-assets: copied ${n} asset(s) into ${assets}`);
