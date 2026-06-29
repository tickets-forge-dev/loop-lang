// Copy the repo's canonical template library into the extension so the .vsix
// ships it. Single source of truth = ../../../templates. Run in `build` before
// packaging. ponytail: a copy, not a registry — the picker's file list lives in
// src/extension.ts.
import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "templates");
const dest = join(here, "..", "templates");

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });
console.log(`synced templates → ${dest}`);
