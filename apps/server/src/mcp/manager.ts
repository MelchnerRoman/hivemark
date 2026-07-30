import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { repo } from "../db.js";
import { MCP_TOOL_REGISTRY } from "./registry.js";
import { callSlackTool, SLACK_TOOL_DEFS } from "./slack.js";
import { callLinearTool, LINEAR_TOOL_DEFS } from "./linear.js";

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** One live connection session spanning a single agent turn. Connects only the
 * granted + actually-connected tools, exposes their tools under a namespaced
 * name (`<mcpToolId>__<originalName>`) to avoid collisions across servers,
 * and tears everything down at the end of the turn. */
export class ToolSession {
  private clients = new Map<string, Client>();
  private toolOwner = new Map<string, string>(); // namespaced tool name -> mcp tool id

  async connect(mcpToolIds: string[]): Promise<AnthropicToolDef[]> {
    const defs: AnthropicToolDef[] = [];
    for (const mcpToolId of mcpToolIds) {
      const config = MCP_TOOL_REGISTRY[mcpToolId];
      if (!config) continue;

      if (config.kind === "custom") {
        const credential = repo.getConnectionValue(config.connectionKey);
        if (!credential) continue; // not configured — silently unavailable this turn
        const customDefs = mcpToolId === "mcp-slack" ? SLACK_TOOL_DEFS : LINEAR_TOOL_DEFS;
        for (const def of customDefs) {
          const namespaced = `${mcpToolId}__${def.name}`;
          this.toolOwner.set(namespaced, mcpToolId);
          defs.push({ ...def, name: namespaced });
        }
        continue;
      }

      // server-backed tool
      const credential = config.connectionKey ? repo.getConnectionValue(config.connectionKey) : null;
      if (config.connectionKey && !credential) continue; // needs a credential we don't have

      try {
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args(credential),
          env: { ...processEnvSubset(), ...(config.env ? config.env(credential) : {}) },
          stderr: "ignore",
        });
        const client = new Client({ name: "hivemark", version: "0.1.0" });
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

    if (mcpToolId === "mcp-slack") return callSlackTool(originalName, args);
    if (mcpToolId === "mcp-linear") return callLinearTool(originalName, args);

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
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // best-effort cleanup
      }
    }
    this.clients.clear();
  }
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
