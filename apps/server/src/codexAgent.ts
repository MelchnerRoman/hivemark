import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { getAgentWorkspaceDir, getRoomProjectDir, hasBashAccess } from "./agentSandbox.js";
import type { Agent } from "./types.js";
import type { HistoryMessage } from "./claudeAgent.js";

/**
 * Runs a turn through the real Codex CLI via the Agent Client Protocol,
 * spawning `npx @agentclientprotocol/codex-acp` (an ACP server wrapping
 * Codex) over stdio and talking to it with the official ACP TypeScript SDK.
 * Auth is whatever's already configured for the Codex CLI on this machine
 * (OPENAI_API_KEY / CODEX_API_KEY env var, or ChatGPT login) — Hivemark
 * doesn't store a separate credential for this runtime.
 *
 * Codex can request permission to run shell commands / edit files. Text-only
 * unless the agent has real Bash/tool access granted (see agentSandbox.ts —
 * requires both a server-wide opt-in AND a per-agent grant): without it,
 * every permission request is auto-denied (picks a "reject" option), same as
 * before. With it, requests are auto-approved (picks an "allow" option) and
 * the session's cwd is the agent's own confined workspace directory instead
 * of the shared OS tmpdir — or, when replying in a Room, that Room's shared
 * project folder, so Codex's edits land where other agents can see them too.
 */
/** Spawns codex-acp and connects to it; the caller kills `child`. */
function startCodex(client: acp.Client, signal?: AbortSignal) {
  const child = spawn("npx", ["-y", "@agentclientprotocol/codex-acp"], {
    stdio: ["pipe", "pipe", "pipe"],
    signal,
  });
  const out = { stderr: "" };
  child.stderr.on("data", (chunk) => (out.stderr += chunk));
  // Spawn failure (ENOENT) or abort — unhandled, either would crash the whole
  // server; the closed stdout then fails the pending ACP request.
  child.on("error", (err) => (out.stderr += String(err)));
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  );
  return { child, out, connection: new acp.ClientSideConnection(() => client, stream) };
}

type ModelOption = { value: string };
/** The session's "model" config option values (ACP session config options). */
function modelValues(session: acp.NewSessionResponse): string[] {
  const option = session.configOptions?.find((o) => o.category === "model" && o.type === "select");
  return option && "options" in option ? (option.options as ModelOption[]).flatMap((o) => ("value" in o ? [o.value] : [])) : [];
}

/** Models the Codex CLI offers for the account it's signed in with. Opening a
 * session costs nothing (no prompt is sent), but takes a few seconds — cached. */
let codexModels: { at: number; models: string[] } | null = null;
export async function listCodexModels(): Promise<string[]> {
  if (codexModels && Date.now() - codexModels.at < 10 * 60_000) return codexModels.models;
  const { child, connection } = startCodex({
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    sessionUpdate: async () => {},
  });
  try {
    await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    const models = modelValues(await connection.newSession({ cwd: tmpdir(), mcpServers: [] }));
    codexModels = { at: Date.now(), models };
    return models;
  } finally {
    child.kill();
  }
}

export async function runCodexTurn(
  agent: Agent,
  system: string,
  history: HistoryMessage[],
  roomId: string | null,
  signal: AbortSignal
): Promise<string> {
  const bashAccess = hasBashAccess(agent);
  const workspaceDir = bashAccess ? (roomId ? getRoomProjectDir(roomId) : getAgentWorkspaceDir(agent.id)) : undefined;
  const textChunks: string[] = [];
  const { child, out, connection } = startCodex(
    {
      async requestPermission(params) {
        const option = bashAccess
          ? (params.options.find((o) => o.kind === "allow_once" || o.kind === "allow_always") ?? params.options[0])
          : (params.options.find((o) => o.kind === "reject_once" || o.kind === "reject_always") ?? params.options[0]);
        return { outcome: { outcome: "selected", optionId: option.optionId } };
      },
      async sessionUpdate(params) {
        const update = params.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          textChunks.push(update.content.text);
        }
      },
    },
    signal
  );

  try {
    await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    const session = await connection.newSession({ cwd: workspaceDir ?? tmpdir(), mcpServers: [] });
    // Empty (or a Claude name left over from another runtime) = Codex's own default.
    if (agent.model && modelValues(session).includes(agent.model)) {
      await connection.setSessionConfigOption({ sessionId: session.sessionId, configId: "model", value: agent.model });
    }

    const transcript = history.map((m) => `${m.role === "assistant" ? "You" : "Message"}: ${m.content}`).join("\n\n");
    const prompt = `${system}\n\n${transcript}\n\nRespond with your next message only, no preamble.`;

    await connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: prompt }] });

    return textChunks.join("").trim() || "(no response)";
  } catch (err) {
    if (out.stderr.trim()) throw new Error(`${String(err)} — ${out.stderr.trim().slice(0, 300)}`);
    throw err;
  } finally {
    child.kill();
  }
}
