import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Names that ship with the standard library. */
export const PRESETS = ["BMAD"];

/**
 * Resolve a `use` reference to its .loop source.
 *
 *   "BMAD"               -> bundled stdlib preset
 *   "./my-method.loop"   -> local file, resolved from `baseDir`
 *   "owner/method"       -> registry ref (deferred; throws in v1)
 *
 * @param {string} ref     the value of `config.use`
 * @param {string} baseDir directory the project.loop lives in (for local refs)
 * @returns {{ name: string, source: string }}
 */
export function resolvePreset(ref, baseDir = process.cwd()) {
  if (!ref) throw new Error("resolvePreset: empty reference");

  // local path
  if (ref.startsWith(".") || isAbsolute(ref) || ref.endsWith(".loop")) {
    const path = isAbsolute(ref) ? ref : resolve(baseDir, ref);
    if (!existsSync(path)) throw new Error(`preset file not found: ${path}`);
    return { name: ref, source: readFileSync(path, "utf8") };
  }

  // bundled stdlib name (case-insensitive)
  const match = PRESETS.find((p) => p.toLowerCase() === ref.toLowerCase());
  if (match) {
    return { name: match, source: readFileSync(resolve(here, `${match}.loop`), "utf8") };
  }

  // registry form owner/method — not in v1
  if (ref.includes("/")) {
    throw new Error(`registry presets ("${ref}") are not supported yet — coming with the v2 preset registry`);
  }

  throw new Error(`unknown preset "${ref}". Known stdlib presets: ${PRESETS.join(", ")}`);
}
