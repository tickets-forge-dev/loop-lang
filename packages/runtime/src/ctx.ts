import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CtxAdapter, CtxProvisionResult } from "./types.js";

const EMPTY: CtxProvisionResult = { useSkills: [] };

/**
 * Parse the JSON object a ctx loop tool returns from its MCP text content. The ctx
 * `ctx__loop_provision` / `ctx__loop_topup` tools return `{ use_skills, installed, skipped }`
 * encoded as a text content block. Anything unexpected degrades to "no skills".
 */
function parseResult(raw: unknown): CtxProvisionResult {
  const content = (raw as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = Array.isArray(content)
    ? content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("")
    : "";
  if (!text) return EMPTY;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return EMPTY;
  }
  const names = (obj.use_skills ?? obj.useSkills) as unknown;
  // capabilities.<group> is a list of {name,...} entries (ctx.loop_adapter.v1); pull bare names.
  const caps = obj.capabilities as Record<string, unknown> | undefined;
  const groupNames = (g: string): string[] | undefined => {
    const list = caps?.[g];
    if (!Array.isArray(list)) return undefined;
    return list
      .map((e) => (e && typeof e === "object" ? (e as { name?: unknown }).name : e))
      .filter((s): s is string => typeof s === "string");
  };
  const capabilities = caps
    ? {
        skills: groupNames("skills"),
        agents: groupNames("agents"),
        mcps: groupNames("mcps"),
        harnesses: groupNames("harnesses"),
      }
    : undefined;
  return {
    useSkills: Array.isArray(names) ? names.filter((s): s is string => typeof s === "string") : [],
    installed: Array.isArray(obj.installed) ? (obj.installed as string[]) : undefined,
    skipped: Array.isArray(obj.skipped) ? (obj.skipped as string[]) : undefined,
    capabilities,
    harnessInstall: typeof obj.harness_install === "string" ? (obj.harness_install as string) : null,
    warnings: Array.isArray(obj.warnings) ? (obj.warnings as string[]) : undefined,
  };
}

/** Build the optional ctx tool args (permissions + own-model) shared by provision and topup. */
function ctxArgs(
  permissions?: string[],
  ownModel?: { provider: string; model: string }
): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  if (permissions && permissions.length) a.permissions = permissions;
  if (ownModel) {
    a.own_llm = true;
    a.model_provider = ownModel.provider;
    a.model = ownModel.model;
  }
  return a;
}

/**
 * Talks to a ctx MCP server (`ctx-mcp-server`) over stdio to provision skills for a loop.
 * The child process is spawned lazily on the first call, so attaching this adapter to a loop
 * that never triggers discovery costs nothing.
 */
export class McpCtxAdapter implements CtxAdapter {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(
    private opts: { command?: string; args?: string[]; env?: Record<string, string> } = {}
  ) {}

  private connect(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = new StdioClientTransport({
          command: this.opts.command ?? "ctx-mcp-server",
          args: this.opts.args ?? [],
          env: this.opts.env ?? (process.env as Record<string, string>),
        });
        const client = new Client({ name: "loop-runtime", version: "0.3.0" }, { capabilities: {} });
        await client.connect(transport);
        this.client = client;
        return client;
      })();
    }
    return this.connecting;
  }

  private async call(name: string, args: Record<string, unknown>): Promise<CtxProvisionResult> {
    const client = await this.connect();
    const res = await client.callTool({ name, arguments: args });
    return parseResult(res);
  }

  provision(input: {
    goal: string; intent?: string; baseDir: string;
    permissions?: string[]; ownModel?: { provider: string; model: string };
  }): Promise<CtxProvisionResult> {
    return this.call("ctx__loop_provision", {
      goal: input.goal,
      intent: input.intent,
      ...ctxArgs(input.permissions, input.ownModel),
    });
  }

  topup(input: {
    goal: string; reflection: string; loaded: string[]; baseDir: string;
    permissions?: string[]; ownModel?: { provider: string; model: string };
  }): Promise<CtxProvisionResult> {
    return this.call("ctx__loop_topup", {
      goal: input.goal,
      reflection: input.reflection,
      loaded: input.loaded,
      ...ctxArgs(input.permissions, input.ownModel),
    });
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connecting = null;
    }
  }
}
