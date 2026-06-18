import type { ArchonFetchInput, ArchonPlanSource } from "../types.js";

/**
 * Talks to a running Archon instance (https://github.com/coleam00/Archon) and uses
 * its agent — grounded in a registered codebase — to produce the plan for a loop.
 *
 * Confirmed against the current Archon REST API (TypeScript rewrite, default branch):
 *   POST   /api/conversations                  { codebaseId?, message? } -> { conversationId, id }
 *   POST   /api/conversations/{id}/message      { message }              -> { accepted, status }  (async)
 *   GET    /api/conversations/{id}/messages?limit=N -> [{ role:'user'|'assistant', content, created_at, ... }]
 *
 * Archon dispatches the agent asynchronously, so fetchPlan posts the goal and polls
 * the message list until a new assistant message (the plan) lands. The conversation
 * is reused across loop iterations so Archon keeps context between attempts.
 *
 * Note: the current Archon has no project/task model — that was the older Python app.
 * If you run that legacy version instead, use its /api/projects/{id}/tasks endpoints.
 */
export interface HttpArchonOptions {
  /** Base URL of the Archon server, e.g. "http://localhost:3737". */
  baseUrl: string;
  /** Bearer token, if your Archon requires auth. */
  token?: string;
  /** Codebase id to ground the agent in (Archon registers repos as codebases). */
  codebaseId?: string;
  /** Poll interval while waiting for the assistant's reply. Default 1500ms. */
  pollMs?: number;
  /** Max time to wait for a plan before giving up. Default 120000ms. */
  timeoutMs?: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export class HttpArchonPlanSource implements ArchonPlanSource {
  private conversationId: string | null = null;

  constructor(private opts: HttpArchonOptions) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.token) h.authorization = `Bearer ${this.opts.token}`;
    return h;
  }

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.url(path), { ...init, headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Archon ${init?.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  private async ensureConversation(codebaseId?: string): Promise<string> {
    if (this.conversationId) return this.conversationId;
    // Grounding precedence: the loop's `project` (treated as a codebase ref) wins,
    // else the configured codebaseId. Current Archon has no separate "project" concept.
    const cb = codebaseId ?? this.opts.codebaseId;
    const body = JSON.stringify(cb ? { codebaseId: cb } : {});
    const res = await this.json<{ conversationId?: string; id?: string }>("/api/conversations", {
      method: "POST",
      body,
    });
    const id = res.conversationId ?? res.id;
    if (!id) throw new Error("Archon did not return a conversation id");
    this.conversationId = id;
    return id;
  }

  private async assistantMessages(convId: string): Promise<Message[]> {
    const msgs = await this.json<Message[]>(`/api/conversations/${encodeURIComponent(convId)}/messages?limit=100`);
    return msgs
      .filter((m) => m.role === "assistant")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async fetchPlan(input: ArchonFetchInput): Promise<string> {
    const convId = await this.ensureConversation(input.project);
    const before = (await this.assistantMessages(convId)).length;

    const prompt = [
      `Produce a concise, concrete step-by-step plan to achieve this goal:`,
      input.goal,
      input.reflection ? `Account for the previous failure: ${input.reflection}` : "",
      `Return only the plan.`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.json(`/api/conversations/${encodeURIComponent(convId)}/message`, {
      method: "POST",
      body: JSON.stringify({ message: prompt }),
    });

    // Poll until a new assistant message appears (Archon runs the agent async).
    const pollMs = this.opts.pollMs ?? 1500;
    const deadline = Date.now() + (this.opts.timeoutMs ?? 120_000);
    while (Date.now() < deadline) {
      await delay(pollMs);
      const msgs = await this.assistantMessages(convId);
      if (msgs.length > before) {
        return msgs[msgs.length - 1].content;
      }
    }
    throw new Error("Archon did not return a plan within the timeout");
  }

  async complete(input: { project?: string; goal: string; satisfied: boolean }): Promise<void> {
    // Current Archon has no task-status model; record the outcome as a conversation
    // message so the run is auditable. Best-effort — never fail the loop on this.
    if (!this.conversationId) return;
    const note = `Loop finished "${input.goal}" — ${input.satisfied ? "goal met" : "not satisfied"}.`;
    await this.json(`/api/conversations/${encodeURIComponent(this.conversationId)}/message`, {
      method: "POST",
      body: JSON.stringify({ message: note }),
    }).catch(() => {
      /* best-effort write-back */
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Deterministic Archon source for tests and offline demos. */
export class MockArchonPlanSource implements ArchonPlanSource {
  public readonly fetched: ArchonFetchInput[] = [];
  public readonly completed: Array<{ project?: string; goal: string; satisfied: boolean }> = [];

  constructor(private plans: string[] = ["Archon task: implement the change"]) {}

  async fetchPlan(input: ArchonFetchInput): Promise<string> {
    this.fetched.push(input);
    const i = Math.min(this.fetched.length - 1, this.plans.length - 1);
    return this.plans[i];
  }
  async complete(input: { project?: string; goal: string; satisfied: boolean }): Promise<void> {
    this.completed.push(input);
  }
}
