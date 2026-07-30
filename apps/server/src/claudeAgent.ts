import Anthropic from "@anthropic-ai/sdk";
import { repo } from "./db.js";
import { resolveModelId } from "./modelIds.js";
import { ToolSession } from "./mcp/manager.js";
import { notifySync } from "./events.js";
import type { Agent } from "./types.js";

const MAX_TOOL_ITERATIONS = 6;

type Turn =
  | { kind: "task_room"; taskRoomId: string }
  | { kind: "dm"; agentId: string };

function getAnthropicClient(): Anthropic | null {
  const apiKey = repo.getConnectionValue("anthropic");
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function buildHistoryMessages(agent: Agent, turn: Turn): Anthropic.MessageParam[] {
  const members = repo.getState().members;
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";

  if (turn.kind === "dm") {
    const dms = repo.getDirectMessagesForAgent(agent.id);
    return dms.map((m) => ({
      role: m.authorType === "agent" ? "assistant" : "user",
      content: m.content,
    }));
  }

  const messages = repo.getMessagesForTaskRoom(turn.taskRoomId);
  const agents = repo.getState().agents;
  return messages.map((m) => {
    if (m.authorType === "agent" && m.authorId === agent.id) {
      return { role: "assistant", content: m.content };
    }
    if (m.authorType === "agent") {
      const other = agents.find((a) => a.id === m.authorId);
      return { role: "user", content: `[${other?.name ?? "Agent"}]: ${m.content}` };
    }
    return { role: "user", content: `[${memberName(m.authorId)}]: ${m.content}` };
  });
}

/**
 * Runs one real agentic turn for `agent` against the given conversation
 * (a Task Room chat, or a 1:1 DM), using the Anthropic API plus whatever MCP
 * tools the agent currently has granted AND has a stored credential for.
 * Persists the assistant's reply (or a clear error message) and flips the
 * agent's status running -> idle/error, broadcasting a sync on every change.
 */
export async function runAgentTurn(agentId: string, turn: Turn): Promise<void> {
  const agent = repo.getAgent(agentId);
  if (!agent) return;

  repo.setAgentStatus(agentId, "running");
  notifySync();

  const reply = (text: string) => {
    if (turn.kind === "dm") repo.addDirectMessage(agentId, "agent", text);
    else repo.addMessage(turn.taskRoomId, "agent", agentId, text);
  };

  const client = getAnthropicClient();
  if (!client) {
    reply(
      "I don't have an Anthropic API key configured yet. Add one in Agent settings → Connections, then try again."
    );
    repo.setAgentStatus(agentId, "error");
    notifySync();
    return;
  }

  const session = new ToolSession();
  try {
    const grantedToolIds = agent.grants.map((g) => g.toolId);
    const tools = await session.connect(grantedToolIds);

    const system = [
      `You are ${agent.name}, an AI agent embedded in a team chat app called Hivemark.`,
      agent.instructions ? `Your instructions: ${agent.instructions}` : null,
      "You are replying inside a real-time chat, not writing a document — keep responses to a few sentences unless the task genuinely needs more.",
      "If you don't have a tool you'd need to fully answer, say so plainly instead of guessing.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: Anthropic.MessageParam[] = buildHistoryMessages(agent, turn);
    const anthropicTools: Anthropic.Tool[] | undefined = tools.length
      ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as any }))
      : undefined;

    let finalText = "";
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: resolveModelId(agent.model),
        max_tokens: 1024,
        system,
        messages,
        ...(anthropicTools ? { tools: anthropicTools } : {}),
      });

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      finalText = textBlocks.map((b) => b.text).join("\n").trim();

      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await session.call(toolUse.name, (toolUse.input as Record<string, unknown>) ?? {});
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.text,
          is_error: result.isError,
        });
      }
      messages.push({ role: "user", content: results });
    }

    reply(finalText || "(no response)");
    repo.setAgentStatus(agentId, "idle");
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err);
    reply(`Something went wrong calling Claude: ${message}`);
    repo.setAgentStatus(agentId, "error");
  } finally {
    await session.close();
    notifySync();
  }
}
