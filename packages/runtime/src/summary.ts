import type { LoopEvent } from "./types.js";

export interface TierSummary {
  tier: "fast" | "strong";
  model?: string;
  calls: number;
  byNode: Record<string, number>;
}

export function summarizeModels(events: LoopEvent[]): TierSummary[] {
  const acc: Record<string, TierSummary> = {};
  for (const e of events) {
    if (e.type !== "model") continue;
    const s = (acc[e.tier] ??= { tier: e.tier, model: e.model, calls: 0, byNode: {} });
    if (e.model && !s.model) s.model = e.model;
    s.calls++;
    s.byNode[e.node] = (s.byNode[e.node] ?? 0) + 1;
  }
  return Object.values(acc);
}

export interface OpexSummary {
  cycles: number;
  reflects: number;
  firstPass: boolean | null;
  stopReason?: string;
  satisfied: boolean;
}

/** Compute the OpEx report from a run's event trace — the "token burn of unverified loops", made visible. */
export function summarizeOpex(events: LoopEvent[]): OpexSummary {
  const observes = events.filter((e): e is Extract<LoopEvent, { type: "observe" }> => e.type === "observe");
  const stop = [...events].reverse().find((e): e is Extract<LoopEvent, { type: "stop" }> => e.type === "stop");
  const end = [...events].reverse().find((e): e is Extract<LoopEvent, { type: "loop-end" }> => e.type === "loop-end");
  return {
    cycles: observes.length,
    reflects: events.filter((e) => e.type === "reflect").length,
    firstPass: observes.length ? observes[0].passed : null,
    stopReason: stop?.reason,
    satisfied: end?.satisfied ?? false,
  };
}

export function formatOpexSummary(s: OpexSummary): string {
  const fp = s.firstPass === null ? "n/a" : s.firstPass ? "yes" : "no";
  return `OpEx — ${s.cycles} cycle${s.cycles === 1 ? "" : "s"}, ${s.reflects} reflect${s.reflects === 1 ? "" : "s"} (back-edges), first-pass success: ${fp}, ${s.satisfied ? "satisfied" : "not satisfied"}${s.stopReason ? ` (${s.stopReason})` : ""}`;
}

export function formatModelSummary(s: TierSummary[]): string {
  if (s.length === 0) return "";
  const total = s.reduce((n, t) => n + t.calls, 0);
  const lines = s.map((t) => {
    const nodes = Object.entries(t.byNode).map(([n, c]) => `${n} ×${c}`).join(", ");
    return `  ${t.tier}${t.model ? ` (${t.model})` : ""}: ${t.calls} call${t.calls === 1 ? "" : "s"}  ·  ${nodes}`;
  });
  return [`models — ${total} LLM call${total === 1 ? "" : "s"}:`, ...lines].join("\n");
}
