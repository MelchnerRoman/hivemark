import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { repo } from "../db.js";
import { MCP_TOOL_REGISTRY } from "./registry.js";
import { TOOL_ACCESS_ENABLED } from "../agentSandbox.js";

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** One live connection session, potentially spanning many agent turns (see
 * the session cache below). Connects only the granted + actually-connected
 * tools, exposes their tools under a namespaced name (`<mcpToolId>__<originalName>`)
 * to avoid collisions across servers. `isHealthy` flips false if any
 * underlying connection drops, so the cache knows to discard and reconnect. */
export class ToolSession {
  private clients = new Map<string, Client>();
  private toolOwner = new Map<string, string>(); // namespaced tool name -> mcp tool id
  private healthy = true;

  get isHealthy() {
    return this.healthy;
  }

  async connect(mcpToolIds: string[], agentId: string, roomId: string | null): Promise<AnthropicToolDef[]> {
    const defs: AnthropicToolDef[] = [];
    for (const mcpToolId of mcpToolIds) {
      const config = MCP_TOOL_REGISTRY[mcpToolId];
      if (!config) continue;

      const credential = config.connectionKey ? repo.getConnectionValue(config.connectionKey) : null;
      if (config.connectionKey && !credential) continue; // needs a credential we don't have

      // "mcp-preview" lets an agent run a real dev server (npm install +
      // npm run dev) — same server-wide opt-in as Bash access, on top of the
      // per-agent grant already required to reach this loop. And it's
      // useless without a Room to preview (a DM turn has none).
      if (mcpToolId === "mcp-preview" && (!TOOL_ACCESS_ENABLED || !roomId)) continue;

      try {
        const transport =
          config.kind === "http"
            ? new StreamableHTTPClientTransport(new URL(config.url), {
                requestInit: { headers: config.headers(credential as string) },
              })
            : new StdioClientTransport({
                command: config.command,
                args: config.args(credential, agentId, roomId),
                env: { ...processEnvSubset(), ...(config.env ? config.env(credential) : {}) },
                stderr: "ignore",
              });
        const client = new Client({ name: "hivemark", version: "0.1.0" });
        client.onclose = () => {
          this.healthy = false;
        };
        client.onerror = () => {
          this.healthy = false;
        };
        await client.connect(transport);
        const { tools } = await client.listTools();
        this.clients.set(mcpToolId, client);
        for (const tool of tools) {
          const namespaced = `${mcpToolId}__${tool.name}`;
          this.toolOwner.set(namespaced, mcpToolId);
          defs.push({
            name: namespaced,
            description: tool.description ?? tool.name,
            input_schema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
          });
        }
      } catch (err) {
        // A tool failing to connect (missing binary, bad creds, no network)
        // shouldn't take down the whole turn — just proceed without it.
        console.error(`[mcp] failed to connect ${mcpToolId}:`, err);
      }
    }
    return defs;
  }

  async call(namespacedName: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const mcpToolId = this.toolOwner.get(namespacedName);
    const originalName = namespacedName.includes("__")
      ? namespacedName.slice(namespacedName.indexOf("__") + 2)
      : namespacedName;
    if (!mcpToolId) return { text: `Unknown tool: ${namespacedName}`, isError: true };

    const client = this.clients.get(mcpToolId);
    if (!client) return { text: `Tool ${namespacedName} is not connected`, isError: true };
    try {
      const result = await client.callTool({ name: originalName, arguments: args });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((block: any) => (block.type === "text" ? block.text : JSON.stringify(block)))
        .join("\n");
      return { text: text || "(no output)", isError: !!(result as any).isError };
    } catch (err) {
      return { text: `Tool call failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  async close() {
    for (const [mcpToolId, client] of this.clients) {
      try {
        await client.close();
      } catch (err) {
        console.error(`[mcp] error closing ${mcpToolId} (best-effort, continuing):`, err);
      }
    }
    this.clients.clear();
  }
}

type CachedSession = { session: ToolSession; toolIds: string[]; tools: AnthropicToolDef[]; lastUsedAt: number };

/** Session cache keyed by `${agentId}::${roomId ?? "dm"}`, not agentId alone
 * — an MCP server's allowed roots (e.g. the filesystem tool's Room project
 * dir) are fixed at spawn time, so a session cached under the wrong Room
 * would silently keep serving that Room's files after the agent moves to
 * another one. A Room change is just a normal cache miss under this key, no
 * extra staleness check needed. Spawning an MCP server (e.g. a headless
 * browser) is expensive, so a session is kept alive and reused across turns
 * in the same room instead of reconnecting every time — invalidated when the
 * agent's granted tools change or the underlying connection drops. Idle
 * sessions are swept up periodically (see startIdleSessionSweep) so e.g. a
 * headless Chromium doesn't sit running forever after an agent goes quiet.
 * ponytail: an agent active in N rooms now spins up N full tool sessions
 * (all its granted tools, not just filesystem) instead of sharing one — fine
 * for a small self-hosted team; split filesystem into its own room-keyed
 * sub-session if that ever actually shows up as wasteful. */
const sessionsByAgent = new Map<string, CachedSession>();

const SESSION_IDLE_TIMEOUT_MS = 10 * 60_000;
const SESSION_SWEEP_INTERVAL_MS = 60_000;

function sessionKey(agentId: string, roomId: string | null): string {
  return `${agentId}::${roomId ?? "dm"}`;
}

function sameToolIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

export async function getSessionForAgent(
  agentId: string,
  mcpToolIds: string[],
  roomId: string | null
): Promise<{ session: ToolSession; tools: AnthropicToolDef[] }> {
  const key = sessionKey(agentId, roomId);
  const cached = sessionsByAgent.get(key);
  if (cached && cached.session.isHealthy && sameToolIds(cached.toolIds, mcpToolIds)) {
    cached.lastUsedAt = Date.now();
    return { session: cached.session, tools: cached.tools };
  }
  if (cached) await cached.session.close();

  const session = new ToolSession();
  const tools = await session.connect(mcpToolIds, agentId, roomId);
  sessionsByAgent.set(key, { session, toolIds: [...mcpToolIds], tools, lastUsedAt: Date.now() });
  return { session, tools };
}

/** Closes every cached session for this agent, across every Room it's been
 * used in — called on agent deletion, where a single agentId now maps to
 * potentially several cache entries (see the keying scheme above). */
export async function closeAgentSession(agentId: string): Promise<void> {
  const prefix = `${agentId}::`;
  const toClose = [...sessionsByAgent.entries()].filter(([key]) => key.startsWith(prefix));
  for (const [key, cached] of toClose) {
    sessionsByAgent.delete(key);
    await cached.session.close();
  }
}

export async function closeAllAgentSessions(): Promise<void> {
  const all = [...sessionsByAgent.values()];
  sessionsByAgent.clear();
  await Promise.all(all.map((c) => c.session.close()));
}

/** Closes any cached session unused for longer than SESSION_IDLE_TIMEOUT_MS.
 * Call once at server startup, alongside startScheduler(). */
export function startIdleSessionSweep() {
  setInterval(() => {
    const now = Date.now();
    for (const [agentId, cached] of sessionsByAgent) {
      if (now - cached.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
        sessionsByAgent.delete(agentId);
        cached.session
          .close()
          .catch((err) => console.error(`[mcp] error closing idle session for ${agentId}:`, err));
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS);
}

/** A minimal, safe subset of the parent env for spawned MCP server processes. */
function processEnvSubset(): Record<string, string> {
  const keep = ["PATH", "HOME", "USER", "LANG", "TMPDIR", "NODE_ENV"];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}
