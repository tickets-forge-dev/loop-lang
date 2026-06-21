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

export function formatModelSummary(s: TierSummary[]): string {
  if (s.length === 0) return "";
  const total = s.reduce((n, t) => n + t.calls, 0);
  const lines = s.map((t) => {
    const nodes = Object.entries(t.byNode).map(([n, c]) => `${n} ×${c}`).join(", ");
    return `  ${t.tier}${t.model ? ` (${t.model})` : ""}: ${t.calls} call${t.calls === 1 ? "" : "s"}  ·  ${nodes}`;
  });
  return [`models — ${total} LLM call${total === 1 ? "" : "s"}:`, ...lines].join("\n");
}
