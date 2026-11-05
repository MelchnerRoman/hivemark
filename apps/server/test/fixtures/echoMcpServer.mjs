// Tiny stdio MCP server for customMcp.test.ts: one "echo" tool that reports
// what it got and whether its env carries the custom secret (and nothing it
// shouldn't, like the Hivemark server's own Anthropic key).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "1.0.0" });
server.registerTool("echo", { description: "Echo text back", inputSchema: { text: z.string() } }, async ({ text }) => ({
  content: [
    {
      type: "text",
      text: `echo:${text} secret:${process.env.ECHO_SECRET === "s3cr3t-value-xyz" ? "ok" : "missing"} anthropic:${process.env.ANTHROPIC_API_KEY ? "leaked" : "clean"} arg:${process.argv[2]}`,
    },
  ],
}));
await server.connect(new StdioServerTransport());
