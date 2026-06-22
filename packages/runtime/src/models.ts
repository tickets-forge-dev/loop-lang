import type { ModelPolicy } from "@loop-lang/parser";

export type Tier = "fast" | "strong";
export type Phase = "plan" | "act" | "reflect" | "also";

export interface EffectiveModels {
  phases: Record<Phase, Tier>;
  tiers: { fast?: string; strong?: string };
}

export const BUILTIN_PHASES: Record<Phase, Tier> = { plan: "fast", act: "strong", reflect: "fast", also: "fast" };

export function resolveModels(...levels: (ModelPolicy | null | undefined)[]): EffectiveModels {
  const eff: EffectiveModels = { phases: { ...BUILTIN_PHASES }, tiers: {} };
  for (const lvl of levels) {
    if (!lvl) continue;
    if (lvl.tiers) {
      if (lvl.tiers.fast !== undefined) eff.tiers.fast = lvl.tiers.fast;
      if (lvl.tiers.strong !== undefined) eff.tiers.strong = lvl.tiers.strong;
    }
    if (lvl.phases) {
      for (const k of Object.keys(lvl.phases) as Phase[]) {
        const v = lvl.phases[k];
        if (v !== undefined) eff.phases[k] = v;
      }
    }
  }
  return eff;
}

export function modelForPhase(eff: EffectiveModels, phase: Phase, cliModel?: string): string | undefined {
  if (cliModel) return cliModel;
  return eff.tiers[eff.phases[phase]];
}
