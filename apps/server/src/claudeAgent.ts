import fs from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { repo } from "./db.js";
import { resolveModelId } from "./modelIds.js";
import { getSessionForAgent, type ToolResult } from "./mcp/manager.js";
import { notifySync } from "./events.js";
import { runOpenRouterTurn } from "./openrouterAgent.js";
import { runClaudeCodeTurn } from "./claudeCodeAgent.js";
import { runCodexTurn } from "./codexAgent.js";
import { runGooseTurn } from "./gooseAgent.js";
import { getRoomProjectDir, hasBashAccess, resolveFileInDir } from "./agentSandbox.js";
import { createWorkspaceTools } from "./workspaceTools.js";
import type { Agent } from "./types.js";

// Real work (a research report, a page of code, a design pass) takes many
// tool round-trips and long outputs — the old 6 x 1024 tokens cut agents off.
const MAX_TOOL_ITERATIONS = 25;
const MAX_OUTPUT_TOKENS = 32_000;
// Agents hand work to each other by @mentioning — cap the chain so two
// agents can't ping-pong forever.
const MAX_HANDOFF_DEPTH = 8;
// Only the most recent messages' attachments are sent as real file content
// (images/PDFs are big and would otherwise be re-sent on every turn); older
// ones are still named in the text, and file tools can re-read them.
const ATTACHMENT_CONTENT_WINDOW = 10;
// Claude rejects requests over 32 MB (base64 adds a third), so attachment
// content shares one raw-byte budget, filled newest-first.
const ATTACHMENT_BYTES_BUDGET = 20 * 1024 * 1024;
// ~100k tokens: keeps a long room inside every model's context window
// (Haiku's is 200k) — older messages are dropped with a note, not silently.
const HISTORY_CHAR_BUDGET = 400_000;

// originMemberId: the human whose message started this (handoff chain) —
// handoffs only reach agents that member can see. Absent for a Loop.
type Turn =
  | { kind: "task_room"; taskRoomId: string; depth?: number; note?: string; originMemberId?: string }
  | { kind: "dm"; agentId: string; memberId: string; note?: string };

/** `content` is self-contained text (attachments named inline) for the
 * text-only runtimes; the Anthropic path also turns `attachments` into real
 * image/document blocks. */
export type HistoryMessage = { role: "user" | "assistant"; content: string; attachments?: string[] };

function getAnthropicClient(): Anthropic | null {
  const apiKey = repo.getConnectionValue("anthropic");
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Agents @mentioned in `content` — whole-name matches only, so "@Dev"
 * doesn't also trigger "@Developer". */
export function findMentionedAgents(content: string): Agent[] {
  return repo
    .getAllAgents()
    .filter((a) => new RegExp(`@${escapeRegExp(a.name)}(?![\\w-])`, "i").test(content));
}

// You can be @mentioned from any room, not just the one you were created in —
// this tells you which one you're currently replying in, since your own
// instructions won't say.
function buildRoomContext(taskRoomId: string): string | null {
  const taskRoom = repo.getTaskRoom(taskRoomId);
  if (!taskRoom) return null;
  const room = repo.getRoom(taskRoom.roomId);
  return [
    `You're currently replying in the "${taskRoom.name}" task room (status: ${taskRoom.status})`,
    room ? ` inside the "${room.name}" room.` : ".",
  ].join("");
}

/** Who else is on the team, so a lead (e.g. a project manager) knows whom it
 * can hand work to — and that mentioning someone actually wakes them. */
/** Agents a task-room turn may hand off to: those the originating member can
 * see; without one (a Loop), only agents belonging to this task room's Room. */
function canHandOffTo(turn: Extract<Turn, { kind: "task_room" }>, agent: Agent): boolean {
  if (turn.originMemberId) return repo.canSeeAgent(turn.originMemberId, agent);
  const roomId = repo.getTaskRoom(turn.taskRoomId)?.roomId;
  return !!roomId && (agent.roomId === roomId || repo.getTaskRoom(agent.taskRoomId)?.roomId === roomId);
}

function buildTeammates(agent: Agent, turn: Extract<Turn, { kind: "task_room" }>): string | null {
  const others = repo.getAllAgents().filter((a) => a.id !== agent.id && canHandOffTo(turn, a));
  if (others.length === 0) return null;
  const lines = others.slice(0, 30).map((a) => {
    const role = a.instructions.split("\n")[0].slice(0, 160);
    return `- @${a.name}${role ? `: ${role}` : ""}`;
  });
  return [
    "Your teammates (AI agents in this workspace):",
    ...lines,
    "Writing @Name in a task-room reply hands work to that teammate — they're triggered automatically and see the whole conversation. Only mention a teammate when you want them to act now, and say exactly what you need from them.",
  ].join("\n");
}

function withAttachmentNote(content: string, attachments: string[]): string {
  return attachments.length ? `${content}\n[Attached files in the project folder: ${attachments.join(", ")}]` : content;
}

function buildHistoryMessages(agent: Agent, turn: Turn): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  if (turn.kind === "dm") {
    for (const m of repo.getDirectMessagesForAgent(agent.id, turn.memberId)) {
      history.push({ role: m.authorType === "agent" ? "assistant" : "user", content: m.content });
    }
  } else {
    // Only fetched for task-room turns (DMs above never need a member name) —
    // and via the lightweight targeted queries below, not the full getState()
    // (all messages, all DMs, connection checks, ...), since this runs on
    // every single agent turn.
    const members = repo.getAllMembers();
    const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";
    const agents = repo.getAllAgents();
    for (const m of repo.getMessagesForTaskRoom(turn.taskRoomId)) {
      const content = withAttachmentNote(m.content, m.attachments);
      if (m.authorType === "agent" && m.authorId === agent.id) {
        history.push({ role: "assistant", content });
      } else {
        const name =
          m.authorType === "agent" ? (agents.find((a) => a.id === m.authorId)?.name ?? "Agent") : memberName(m.authorId);
        history.push({ role: "user", content: `[${name}]: ${content}`, attachments: m.attachments });
      }
    }
  }
  let chars = 0;
  let keepFrom = history.length;
  while (keepFrom > 0 && chars + history[keepFrom - 1].content.length <= HISTORY_CHAR_BUDGET) {
    chars += history[--keepFrom].content.length;
  }
  if (keepFrom > 0) {
    history.splice(0, keepFrom, {
      role: "user",
      content: `[Hivemark]: ${keepFrom} older message(s) in this conversation aren't shown (too long to send). Ask if you need something from them; files they mention are still in the project folder.`,
    });
  }
  if (turn.note) history.push({ role: "user", content: turn.note });
  // The API rejects a conversation that starts with an assistant turn, or
  // ends on one (no prefill on current models) — e.g. a Task Room opened by
  // this agent's Loop reply, or a Run/queued turn where its own reply is
  // already the latest message.
  if (history[0]?.role === "assistant") history.unshift({ role: "user", content: "[Earlier conversation]" });
  if (history.at(-1)?.role === "assistant") {
    history.push({
      role: "user",
      content:
        "[Hivemark]: Your reply above is the latest message. Follow up on anything still open (e.g. messages that arrived while you were writing it), or reply briefly if nothing is.",
    });
  }
  return history;
}

const IMAGE_MEDIA_TYPES: Record<string, Anthropic.Base64ImageSource["media_type"]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".tsv", ".json", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".svg", ".xml", ".yaml", ".yml",
]);
// The API's 5MB image cap applies to the base64 string, i.e. 3.75MB raw.
const MAX_IMAGE_BYTES = (5 * 1024 * 1024 * 3) / 4;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 200 * 1024;

/** A project-folder file as Claude input: image -> image block, PDF ->
 * document block, text/data -> inline text. Null for anything else (too big,
 * over the remaining request budget, binary, missing) — the file is still
 * named in the message text. */
function fileToBlock(dir: string, rel: string, budget: { left: number }): Anthropic.ContentBlockParam | null {
  const full = resolveFileInDir(dir, rel);
  if (!full) return null;
  const ext = path.extname(full).toLowerCase();
  const size = fs.statSync(full).size;
  if (size > budget.left) return null;
  budget.left -= size;
  if (IMAGE_MEDIA_TYPES[ext] && size <= MAX_IMAGE_BYTES) {
    return {
      type: "image",
      source: { type: "base64", media_type: IMAGE_MEDIA_TYPES[ext], data: fs.readFileSync(full).toString("base64") },
    };
  }
  if (ext === ".pdf" && size <= MAX_PDF_BYTES) {
    return {
      type: "document",
      title: rel,
      source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(full).toString("base64") },
    };
  }
  if (TEXT_EXTENSIONS.has(ext) && size <= MAX_TEXT_BYTES) {
    return { type: "text", text: `--- ${rel} ---\n${fs.readFileSync(full, "utf-8")}` };
  }
  return null;
}

function toAnthropicMessages(history: HistoryMessage[], roomId: string | null): Anthropic.MessageParam[] {
  const dir = roomId ? getRoomProjectDir(roomId) : null;
  const budget = { left: ATTACHMENT_BYTES_BUDGET };
  // Walked newest-first so the budget goes to what was just shared.
  return history
    .map((m, i) => ({ m, i }))
    .reverse()
    .map(({ m, i }): Anthropic.MessageParam => {
      const recent = i >= history.length - ATTACHMENT_CONTENT_WINDOW;
      if (!dir || !recent || !m.attachments?.length) return { role: m.role, content: m.content };
      const blocks = m.attachments.map((rel) => fileToBlock(dir, rel, budget));
      const skipped = m.attachments.filter((_, j) => blocks[j] === null);
      const note = skipped.length
        ? `\n[Not included as content (too large, too much attached at once, or not a readable type): ${skipped.join(", ")} — open them with your file tools if needed.]`
        : "";
      return {
        role: m.role,
        content: [...blocks.filter((b) => b !== null), { type: "text", text: m.content + note }],
      };
    })
    .reverse();
}

/** Turns the limits people can actually hit into something actionable;
 * anything else keeps the raw error. */
function friendlyError(err: unknown): string {
  const raw = err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err);
  const lower = raw.toLowerCase();
  if ((err instanceof Anthropic.APIError && err.status === 413) || lower.includes("request_too_large")) {
    return "The files attached in this conversation are too large to send to Claude together (32 MB request limit). Remove or split some of the large attachments — PDFs especially — and try again.";
  }
  if (lower.includes("prompt is too long") || lower.includes("context window") || lower.includes("context_length")) {
    return "This conversation is too long for my model's context window, even with older messages trimmed. Start a new Task Room for the next phase, or switch me to a model with a larger context window.";
  }
  if (lower.includes("pdf") && (lower.includes("page") || lower.includes("invalid"))) {
    return `One of the attached PDFs can't be read by Claude (over the page limit, encrypted, or corrupt). Split it or attach only the pages that matter. (${raw})`;
  }
  if (lower.includes("openrouter 402") || lower.includes("requires more credits")) {
    return "My OpenRouter account doesn't have enough credit for this request. Top up the OpenRouter balance (or raise the key's limit), or switch me to another runtime.";
  }
  if (lower.includes("e2big")) {
    return "This conversation is too long to hand to the agent's command-line tool. Start a new Task Room for the next phase.";
  }
  return `Something went wrong running this agent: ${raw}`;
}

function toolResultContent(result: ToolResult): Anthropic.ToolResultBlockParam["content"] {
  const images = (result.images ?? []).filter((img) => Object.values(IMAGE_MEDIA_TYPES).includes(img.mediaType as never));
  if (images.length === 0) return result.text;
  return [
    { type: "text", text: result.text },
    ...images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mediaType as Anthropic.Base64ImageSource["media_type"], data: img.data },
    })),
  ];
}

/** Anthropic's server-side web search/fetch (they run on Anthropic's side —
 * results come back in the same response, no tool loop on ours). The current
 * `_20260209` variants need Sonnet 4.6+/Opus 4.6+; Haiku gets basic search.
 * Cast because the installed SDK's types predate these versions. */
function webResearchTools(modelId: string): Anthropic.ToolUnion[] {
  const tools = modelId.includes("haiku")
    ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
    : [
        { type: "web_search_20260209", name: "web_search", max_uses: 10 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
      ];
  return tools as unknown as Anthropic.ToolUnion[];
}

// Agent turns are triggered fire-and-forget from several places (a mention,
// a DM, a Loop tick, a teammate's handoff) — without this, the same agent
// could run two turns at once and whichever finishes last would stomp the
// other's "running" status. The controller is what the Stop button aborts
// (see stopAgentTurn). Triggers that arrive mid-turn are queued (one per
// conversation) and run afterwards, instead of being dropped.
const agentsInFlight = new Map<string, AbortController>();

// Workspace tools of in-flight Claude Code turns, by a per-turn token: the
// CLI reaches them through our own MCP server (mcp/workspaceMcpServer.ts),
// which calls back into /internal/turns/<token>/ — see index.ts.
type Workspace = ReturnType<typeof createWorkspaceTools>;
const turnBridges = new Map<string, { workspace: Workspace; signal: AbortSignal }>();
export function getTurnBridge(token: string) {
  return turnBridges.get(token) ?? null;
}
const queuedTurns = new Map<string, Turn[]>();

function conversationKey(turn: Turn) {
  return turn.kind === "dm" ? `dm:${turn.memberId}` : turn.taskRoomId;
}

/** Aborts the agent's in-flight turn, if any (cancels the API request / kills
 * the spawned CLI; the turn ends without posting a reply), and drops any
 * turns queued behind it. */
export function stopAgentTurn(agentId: string) {
  queuedTurns.delete(agentId);
  agentsInFlight.get(agentId)?.abort();
}

/**
 * Runs one real agentic turn for `agent` against the given conversation
 * (a Task Room chat, or a 1:1 DM), using the agent's runtime plus whatever
 * tools it currently has granted AND has a stored credential for. Persists
 * the reply (or a clear error message), flips the agent's status
 * running -> idle/error, broadcasting a sync on every change, and triggers
 * any teammates the reply @mentions.
 */
export async function runAgentTurn(agentId: string, turn: Turn): Promise<void> {
  if (agentsInFlight.has(agentId)) {
    const queue = queuedTurns.get(agentId) ?? [];
    // The queued turn re-reads the whole conversation when it runs, so one
    // pending turn per conversation covers any number of triggers — except a
    // note (a Loop's "do this now"), which isn't in the conversation, and
    // the handoff depth, which should be the shallowest trigger's.
    const queued = queue.find((t) => conversationKey(t) === conversationKey(turn));
    if (!queued) queue.push(turn);
    else {
      if (turn.note) queued.note = queued.note ? `${queued.note}\n\n${turn.note}` : turn.note;
      if (queued.kind === "task_room" && turn.kind === "task_room") {
        queued.depth = Math.min(queued.depth ?? 0, turn.depth ?? 0);
        // Triggered by different people: fall back to the Room-only rule
        // rather than letting one member's visibility cover the other's.
        if (queued.originMemberId !== turn.originMemberId) queued.originMemberId = undefined;
      }
    }
    queuedTurns.set(agentId, queue);
    return;
  }
  const controller = new AbortController();
  agentsInFlight.set(agentId, controller);
  try {
    await runAgentTurnLocked(agentId, turn, controller.signal);
  } finally {
    agentsInFlight.delete(agentId);
    const next = queuedTurns.get(agentId)?.shift();
    if (next) void runAgentTurn(agentId, next).catch((err) => console.error("queued agent turn failed", err));
  }
}

async function runAgentTurnLocked(agentId: string, turn: Turn, signal: AbortSignal): Promise<void> {
  const agent = repo.getAgent(agentId);
  if (!agent) return;

  repo.setAgentStatus(agentId, "running");
  notifySync();

  const reply = (text: string, attachments: string[] = []) => {
    if (turn.kind === "dm") {
      return repo.addDirectMessage(agentId, "agent", withAttachmentNote(text, attachments), null, turn.memberId);
    }
    const mentioned = findMentionedAgents(text).filter((a) => a.id !== agentId && canHandOffTo(turn, a));
    repo.addMessage(turn.taskRoomId, "agent", agentId, text, mentioned.map((a) => a.id), attachments);
    const depth = (turn.depth ?? 0) + 1;
    if (depth > MAX_HANDOFF_DEPTH) {
      if (mentioned.length) console.log(`[agent] handoff chain hit depth ${MAX_HANDOFF_DEPTH} — not triggering further`);
      return;
    }
    for (const teammate of mentioned) {
      const handoff = { kind: "task_room" as const, taskRoomId: turn.taskRoomId, depth, originMemberId: turn.originMemberId };
      runAgentTurn(teammate.id, handoff).catch((err) =>
        console.error("agent handoff failed", err)
      );
    }
  };

  const runtime = agent.runtimeId;
  const client = runtime === "runtime-hivemark" ? getAnthropicClient() : null;
  if (runtime === "runtime-hivemark" && !client) {
    reply(
      "I don't have an Anthropic API key configured yet. Add one in Agent settings → Connections, then try again."
    );
    repo.setAgentStatus(agentId, "error");
    notifySync();
    return;
  }

  // Resolved once and reused for both the shared tool session's directory
  // and the Bash-capable runtimes' cwd — null for a DM turn, which has no Room.
  const roomId = turn.kind === "task_room" ? repo.getTaskRoom(turn.taskRoomId)?.roomId ?? null : null;

  const grantedToolIds = agent.grants.map((g) => g.toolId);
  // MCP servers and Hivemark's own tools only reach the model on the runtimes
  // whose tool loop runs here; the CLI runtimes (Claude Code, Codex, Goose)
  // bring their own tools — spawning ours for them (e.g. a headless browser)
  // would be wasted, and advertising attach_file to them makes them claim
  // attachments that never happen.
  const runsOurTools = runtime === "runtime-hivemark" || runtime === "runtime-openrouter";
  const { session, tools: mcpTools } = await getSessionForAgent(agentId, runsOurTools ? grantedToolIds : [], roomId);
  const bridged = runtime === "runtime-claude-code";
  const workspace =
    (runsOurTools || bridged) && turn.kind === "task_room" && roomId
      ? createWorkspaceTools(turn.taskRoomId, roomId)
      : null;
  const turnToken = bridged && workspace ? randomBytes(24).toString("hex") : null;
  if (turnToken) turnBridges.set(turnToken, { workspace: workspace!, signal });
  const tools = [...mcpTools, ...(workspace?.defs ?? [])];
  // A throwing tool (network error, non-JSON error page, disk full) is a
  // tool_result error the model can react to, not a failed turn.
  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      return (await workspace?.call(name, args, signal)) ?? (await session.call(name, args));
    } catch (err) {
      if (signal.aborted) throw err;
      return { text: `Tool call failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  };
  // Keeps the idle sweep from closing the session mid-turn (long turns can
  // go well past its timeout between tool calls).
  session.inUse++;

  try {
    // Claude Code maps the Files grant (or Bash) onto its own Write/Edit in the Room folder.
    const hasFileTools =
      mcpTools.some((t) => t.name.startsWith("mcp-filesystem__")) ||
      (runtime === "runtime-claude-code" && !!roomId && (grantedToolIds.includes("mcp-filesystem") || hasBashAccess(agent)));
    const system = [
      `You are ${agent.name}, an AI agent working on a team in a chat app called Hivemark — alongside humans and other agents, like staff at an agency.`,
      agent.instructions ? `Your instructions: ${agent.instructions}` : null,
      turn.kind === "task_room" ? buildRoomContext(turn.taskRoomId) : null,
      turn.kind === "dm"
        ? `This is a private 1:1 chat with ${repo.getMember(turn.memberId)?.name ?? "a teammate"}; only they see it.`
        : null,
      turn.kind === "task_room" ? buildTeammates(agent, turn) : null,
      hasFileTools
        ? `Deliverables (reports, research, copy, code, designs, data) belong in files in the Room's shared project folder, not pasted into chat — write them with your file tools${workspace ? ", then attach_file the key ones" : ""}.`
        : null,
      workspace
        ? "For visuals: generate_image (if available) for raster images, or write SVG/HTML files for logos, diagrams, wireframes and UI mockups. Use the todo tools to plan and track work."
        : null,
      "Files people share are attached to their messages; you can read them directly.",
      "In chat itself be concise: what you did, where the output is, and what's next. If you lack a tool you'd need, say so plainly instead of guessing.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const history = buildHistoryMessages(agent, turn);
    let finalText: string;

    switch (runtime) {
      case "runtime-openrouter":
        finalText = await runOpenRouterTurn(agent, system, history, callTool, tools, signal);
        break;
      case "runtime-claude-code":
        finalText = await runClaudeCodeTurn(agent, system, history, roomId, signal, turnToken);
        break;
      case "runtime-codex":
        finalText = await runCodexTurn(agent, system, history, roomId, signal);
        break;
      case "runtime-goose":
        finalText = await runGooseTurn(agent, system, history, signal);
        break;
      default: {
        const modelId = resolveModelId(agent.model);
        const messages = toAnthropicMessages(history, roomId);
        const anthropicTools: Anthropic.ToolUnion[] = [
          ...tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as any })),
          ...(grantedToolIds.includes("web-research") ? webResearchTools(modelId) : []),
        ];

        finalText = "";
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          // Streamed (then collected) since long outputs at this max_tokens
          // can outlast a plain request's HTTP timeout.
          const response = await client!.messages
            .stream(
              {
                model: modelId,
                max_tokens: MAX_OUTPUT_TOKENS,
                system,
                messages,
                ...(anthropicTools.length ? { tools: anthropicTools } : {}),
              },
              { signal }
            )
            .finalMessage();

          const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
          finalText = textBlocks.map((b) => b.text).join("\n").trim();
          if (response.stop_reason === "refusal" && !finalText) finalText = "I can't help with that request.";

          // A long server-side tool run (web search) can pause mid-turn —
          // send the partial turn back as-is to let it continue.
          if (response.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: response.content });
            continue;
          }
          if (response.stop_reason !== "tool_use") break;

          messages.push({ role: "assistant", content: response.content });
          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const toolUse of toolUseBlocks) {
            const result = await callTool(toolUse.name, (toolUse.input as Record<string, unknown>) ?? {});
            results.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: toolResultContent(result),
              is_error: result.isError,
            });
          }
          messages.push({ role: "user", content: results });
          signal.throwIfAborted(); // a tool call can't be cancelled mid-flight, but don't start another round
        }
      }
    }

    signal.throwIfAborted(); // a runtime that resolved despite the abort still mustn't post
    repo.setAgentStatus(agentId, "idle");
    reply(finalText || "(no response)", workspace?.attachments ?? []);
  } catch (err) {
    if (signal.aborted) {
      repo.setAgentStatus(agentId, "idle");
      return;
    }
    console.error(`agent turn failed (${agentId}, runtime=${runtime}):`, err);
    reply(friendlyError(err));
    repo.setAgentStatus(agentId, "error");
  } finally {
    // Session is cached per-agent (see mcp/manager.ts) and reused by the next
    // turn — not closed here, unlike a one-shot connection.
    session.inUse--;
    if (turnToken) turnBridges.delete(turnToken);
    notifySync();
  }
}
