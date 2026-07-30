import { repo } from "../db.js";
import type { AnthropicToolDef } from "./manager.js";

/**
 * There's no widely-trusted, zero-config MCP server for Slack read/export, so
 * this calls Slack's Web API directly with the stored bot token instead of
 * spawning an MCP server. Functionally equivalent from the agent's point of
 * view — it's still a real network call, just not wrapped in a separate
 * MCP server process.
 */
export const SLACK_TOOL_DEFS: AnthropicToolDef[] = [
  {
    name: "search_messages",
    description: "Search Slack messages visible to the bot. Returns matching messages with channel and timestamp.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Slack search query" } },
      required: ["query"],
    },
  },
  {
    name: "post_message",
    description: "Post a message to a Slack channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID or name, e.g. #general" },
        text: { type: "string" },
      },
      required: ["channel", "text"],
    },
  },
];

export async function callSlackTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  const token = repo.getConnectionValue("slack");
  if (!token) return { text: "Slack is not connected.", isError: true };

  try {
    if (name === "search_messages") {
      const res = await fetch(
        `https://slack.com/api/search.messages?query=${encodeURIComponent(String(args.query ?? ""))}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as any;
      if (!data.ok) return { text: `Slack API error: ${data.error}`, isError: true };
      const matches = (data.messages?.matches ?? []).slice(0, 10);
      return {
        text: matches.map((m: any) => `#${m.channel?.name ?? "?"} — ${m.username ?? "?"}: ${m.text}`).join("\n") || "No matches.",
        isError: false,
      };
    }
    if (name === "post_message") {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: args.channel, text: args.text }),
      });
      const data = (await res.json()) as any;
      if (!data.ok) return { text: `Slack API error: ${data.error}`, isError: true };
      return { text: `Posted to ${args.channel}.`, isError: false };
    }
    return { text: `Unknown Slack tool: ${name}`, isError: true };
  } catch (err) {
    return { text: `Slack request failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
