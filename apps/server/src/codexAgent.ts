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
export async function runCodexTurn(
  agent: Agent,
  system: string,
  history: HistoryMessage[],
  roomId: string | null,
  signal: AbortSignal
): Promise<string> {
  const bashAccess = hasBashAccess(agent);
  const workspaceDir = bashAccess ? (roomId ? getRoomProjectDir(roomId) : getAgentWorkspaceDir(agent.id)) : undefined;
  const child = spawn("npx", ["-y", "@agentclientprotocol/codex-acp"], {
    stdio: ["pipe", "pipe", "pipe"],
    signal,
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  // Spawn failure (ENOENT) or abort — unhandled, either would crash the whole
  // server; the closed stdout then fails the pending ACP request below.
  child.on("error", (err) => (stderr += String(err)));

  const textChunks: string[] = [];

  try {
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    );

    const connection = new acp.ClientSideConnection(
      (): acp.Client => ({
        async requestPermission(params) {
          const option = bashAccess
            ? (params.options.find((o) => o.kind === "allow_once" || o.kind === "allow_always") ?? params.options[0])
            : (params.options.find((o) => o.kind === "reject_once" || o.kind === "reject_always") ??
              params.options[0]);
          return { outcome: { outcome: "selected", optionId: option.optionId } };
        },
        async sessionUpdate(params) {
          const update = params.update;
          if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
            textChunks.push(update.content.text);
          }
        },
      }),
      stream
    );

    await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    const session = await connection.newSession({ cwd: workspaceDir ?? tmpdir(), mcpServers: [] });

    const transcript = history.map((m) => `${m.role === "assistant" ? "You" : "Message"}: ${m.content}`).join("\n\n");
    const prompt = `${system}\n\n${transcript}\n\nRespond with your next message only, no preamble.`;

    await connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: prompt }] });

    return textChunks.join("").trim() || "(no response)";
  } catch (err) {
    if (stderr.trim()) throw new Error(`${String(err)} — ${stderr.trim().slice(0, 300)}`);
    throw err;
  } finally {
    child.kill();
  }
}
