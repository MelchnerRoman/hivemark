// A first-party MCP stdio server (not a third-party package like the other
// registry.ts entries) that lets an agent start/stop/check its own Room's
// live preview. Spawned as a separate OS process — see registry.ts's
// "mcp-preview" entry — so it can't call projectRunner.ts's in-process state
// directly; it calls back over HTTP to this same server's /internal/* routes
// instead, authenticated with a per-boot token passed via env (see
// internalAuth.ts) since it has no member session token of its own.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const roomId = process.argv[2];
if (!roomId) {
  console.error("previewMcpServer: no roomId argument given — nothing to preview, exiting.");
  process.exit(1);
}

const port = process.env.HIVEMARK_INTERNAL_PORT ?? "4001";
const token = process.env.HIVEMARK_INTERNAL_TOKEN ?? "";
const base = `http://127.0.0.1:${port}/internal/rooms/${roomId}/preview`;

async function callInternal(path: string, method: string): Promise<string> {
  const res = await fetch(`${base}${path}`, { method, headers: { "x-internal-token": token } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Preview control call failed (${res.status}): ${body}`);
  return body;
}

const server = new McpServer({ name: "hivemark-preview", version: "0.1.0" });

server.registerTool(
  "start_preview",
  { description: "Starts (or returns the already-running) live preview server for this room's shared project." },
  async () => ({ content: [{ type: "text", text: await callInternal("/start", "POST") }] })
);
server.registerTool(
  "stop_preview",
  { description: "Stops this room's running live preview server." },
  async () => ({ content: [{ type: "text", text: await callInternal("/stop", "POST") }] })
);
server.registerTool(
  "get_preview_status",
  { description: "Gets this room's current preview status: mode, status, url, and recent log lines." },
  async () => ({ content: [{ type: "text", text: await callInternal("/status", "GET") }] })
);

await server.connect(new StdioServerTransport());
