import type { HumanIO } from "./types.js";

/** A request the runtime needs a human to answer, emitted over the event protocol. */
export interface HumanRequest {
  kind: "ask";
  id: number;
  human: "plan" | "review" | "gate" | "confirm" | "ask";
  prompt: string;
}

/**
 * A HumanIO that delegates gates to an out-of-process UI (e.g. the VSCode extension):
 * it emits a `HumanRequest` and parks until `resolve(id, approved)` is called with the
 * matching id. Decoupled from any transport — the caller wires emit + the response source.
 */
export class IpcHumanIO implements HumanIO {
  private nextId = 1;
  private pending = new Map<number, (approved: boolean) => void>();

  constructor(private emit: (req: HumanRequest) => void) {}

  /** Feed a response back in (e.g. from a stdin line). Unknown ids are ignored. */
  resolve(id: number, approved: boolean): void {
    const r = this.pending.get(id);
    if (r) {
      this.pending.delete(id);
      r(approved);
    }
  }

  private request(human: HumanRequest["human"], prompt: string): Promise<boolean> {
    const id = this.nextId++;
    return new Promise<boolean>((res) => {
      this.pending.set(id, res);
      this.emit({ kind: "ask", id, human, prompt });
    });
  }

  plan(goal: string): Promise<boolean> {
    return this.request("plan", goal);
  }
  review(goal: string): Promise<boolean> {
    return this.request("review", goal);
  }
  gate(message: string): Promise<boolean> {
    return this.request("gate", message);
  }
  confirm(actionClass: string): Promise<boolean> {
    return this.request("confirm", actionClass);
  }
  async ask(prompt: string): Promise<void> {
    await this.request("ask", prompt);
  }
}
