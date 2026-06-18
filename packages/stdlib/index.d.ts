/** Names that ship with the standard library. */
export const PRESETS: string[];

/** Resolve a `use` reference to its .loop source. */
export function resolvePreset(
  ref: string,
  baseDir?: string
): { name: string; source: string };
