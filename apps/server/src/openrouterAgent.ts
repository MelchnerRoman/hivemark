import { repo } from "./db.js";
import type { ToolResult } from "./mcp/manager.js";
import type { Agent } from "./types.js";
import type { HistoryMessage } from "./claudeAgent.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOOL_ITERATIONS = 25;
// Without an explicit cap OpenRouter reserves the model's full max output
// against the account's credit up front, so a modestly funded key gets 402s
// even for a one-line reply.
const MAX_OUTPUT_TOKENS = 8192;

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

/**
 * Same job as runAgentTurn's Anthropic path, but calling OpenRouter's
 * OpenAI-compatible chat-completions endpoint directly via fetch (no SDK —
 * OpenRouter is plain REST) so an agent can run any model OpenRouter hosts,
 * not just Claude. Reuses the same tool bridge (MCP + built-in workspace
 * tools), translated to OpenAI's function-calling shape.
 */
export async function runOpenRouterTurn(
  agent: Agent,
  system: string,
  history: HistoryMessage[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
  signal: AbortSignal
): Promise<string> {
  const apiKey = repo.getConnectionValue("openrouter");
  if (!apiKey) {
    throw new Error(
      "I don't have an OpenRouter key configured yet. Add one in Agent settings → Connections, then try again."
    );
  }

  const openrouterTools = tools.length
    ? tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    : undefined;

  const messages: OpenRouterMessage[] = [
    { role: "system", content: system },
    ...history.map(({ role, content }) => ({ role, content })),
  ];

  let finalText = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: agent.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages,
        ...(openrouterTools ? { tools: openrouterTools } : {}),
      }),
    });

    const body = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${body?.error?.message ?? JSON.stringify(body)}`);
    }

    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no message");

    finalText = (message.content ?? "").trim();

    const toolCalls: ToolCall[] | undefined = message.tool_calls;
    if (!toolCalls?.length) break;

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // model sent malformed JSON args — proceed with empty args rather than fail the whole turn
      }
      const result = await callTool(call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
    }
  }

  return finalText || "(no response)";
}
