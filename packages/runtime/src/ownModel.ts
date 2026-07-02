import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

/**
 * Local model providers that ship a CLI binary we can detect on PATH. API providers
 * (openai, anthropic, openrouter, litellm, …) authenticate by key — there is no binary to
 * check, so a declared `ctx may use my own model "openai/…"` never warns.
 */
const LOCAL_MODEL_BINARIES: Record<string, string> = {
  ollama: "ollama",
};

/** True if `bin` resolves to an executable on PATH. Cross-platform, no subprocess. */
export function commandOnPath(bin: string): boolean {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (existsSync(join(dir, bin + ext))) return true;
      } catch {
        /* unreadable PATH entry — skip it */
      }
    }
  }
  return false;
}

/**
 * Warn when a `.loop` declares its own local model (`ctx may use my own model …`) but the
 * provider's binary isn't installed. Returns the warning string, or null when there is nothing
 * to warn about: no model declared, an API/unknown provider with no local binary, or the binary
 * is present. Pure — pass `onPath` to test without touching the real PATH.
 */
export function ownModelBinaryWarning(
  ownModel: { provider: string; model: string } | undefined,
  onPath: (bin: string) => boolean = commandOnPath,
): string | null {
  if (!ownModel) return null;
  const bin = LOCAL_MODEL_BINARIES[ownModel.provider.trim().toLowerCase()];
  if (!bin) return null; // API/unknown provider — no local binary to check
  if (onPath(bin)) return null;
  return (
    `⚠ ctx: this file declares its own model "${ownModel.model}" (provider "${ownModel.provider}"), ` +
    `but the \`${bin}\` binary isn't on PATH. The loop still runs on its normal runner; ctx will ` +
    `recommend ${ownModel.provider} harnesses, but actually running one needs \`${bin}\` installed.`
  );
}
