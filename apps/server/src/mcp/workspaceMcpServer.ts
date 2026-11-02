// A first-party MCP stdio server that hands Hivemark's own workspace tools
// (attach_file, generate_image, todos — see workspaceTools.ts) to runtimes
// that bring their own tool loop, i.e. the Claude Code CLI. Like
// previewMcpServer.ts it's a separate process, so every call goes back over
// HTTP to the running server's /internal/turns/<token>/ routes: the turn
// token (minted per agent turn, see claudeAgent.ts) picks that turn's tools,
// so attachments land on the right reply. Auth: loopback + per-boot token.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const port = process.env.HIVEMARK_INTERNAL_PORT ?? "4001";
const base = `http://127.0.0.1:${port}/internal/turns/${process.env.HIVEMARK_TURN_TOKEN}/tools`;
const headers = { "x-internal-token": process.env.HIVEMARK_INTERNAL_TOKEN ?? "", "Content-Type": "application/json" };

const server = new Server({ name: "hivemark", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const res = await fetch(base, { headers });
  if (!res.ok) return { tools: [] }; // turn already over
  const defs = (await res.json()) as { name: string; description: string; input_schema: Record<string, unknown> }[];
  return { tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.input_schema as any })) };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const res = await fetch(`${base}/${encodeURIComponent(req.params.name)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(req.params.arguments ?? {}),
  });
  if (!res.ok) return { content: [{ type: "text", text: `Tool unavailable (${res.status})` }], isError: true };
  const result = (await res.json()) as { text: string; isError: boolean };
  return { content: [{ type: "text", text: result.text }], isError: result.isError };
});

await server.connect(new StdioServerTransport());
