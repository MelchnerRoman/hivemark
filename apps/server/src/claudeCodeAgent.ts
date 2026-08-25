import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolveModelId } from "./modelIds.js";
import { getAgentWorkspaceDir, getRoomProjectDir, hasBashAccess } from "./agentSandbox.js";
import type { Agent } from "./types.js";
import type { HistoryMessage } from "./claudeAgent.js";

// Built-in tools exposed when an agent has real access granted — deliberately
// excludes WebFetch/WebSearch (network access wasn't asked for; this keeps
// the grant scoped to local file/shell work, matching what was requested).
const GRANTED_TOOLS = "Bash,Read,Write,Edit,Glob,Grep";

/**
 * Runs a turn by spawning the actual Claude Code CLI (`claude -p`) instead of
 * calling the Anthropic API ourselves. Auth is whatever's already configured
 * for the CLI on this machine (OAuth login or ANTHROPIC_API_KEY) — Hivemark's
 * own stored Anthropic connection key is not used here.
 *
 * Text-only unless the agent has real Bash/tool access granted (see
 * agentSandbox.ts — requires both a server-wide opt-in AND a per-agent
 * grant). IMPORTANT: Claude Code's headless mode has its full built-in
 * toolset available BY DEFAULT when `--tools` is simply omitted — verified
 * live (a `-p` call issued with no tool flags at all still executed Bash
 * against the server's own cwd, no prompt, no denial). So the ungranted path
 * must explicitly pass `--tools ""` to actually disable tools, not just
 * leave the flag off — omitting it is not the same as denying it. When
 * granted, Bash/Read/Write/Edit/Glob/Grep are enabled but confined to a
 * per-agent workspace directory via `cwd` + `--add-dir` — verified live that
 * this actually blocks reads/writes outside that directory (Claude Code's
 * own permission system enforces it, not just the model choosing not to).
 * When replying in a Room (roomId set), that directory is the Room's shared
 * project folder instead of the agent's private one, so Bash-driven edits
 * land where other agents (and the filesystem MCP tool) can see them too.
 */
export function runClaudeCodeTurn(
  agent: Agent,
  system: string,
  history: HistoryMessage[],
  roomId: string | null
): Promise<string> {
  const transcript = history.map((m) => `${m.role === "assistant" ? "You" : "Message"}: ${m.content}`).join("\n\n");
  const prompt = `${transcript}\n\nRespond with your next message only, no preamble.`;

  const bashAccess = hasBashAccess(agent);
  const workspaceDir = bashAccess
    ? roomId
      ? getRoomProjectDir(roomId)
      : getAgentWorkspaceDir(agent.id)
    : tmpdir();

  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        prompt,
        "--system-prompt",
        system,
        "--model",
        resolveModelId(agent.model),
        "--output-format",
        "json",
        ...(bashAccess
          ? ["--tools", GRANTED_TOOLS, "--add-dir", workspaceDir, "--permission-mode", "acceptEdits"]
          : ["--tools", ""]),
      ],
      { stdio: ["ignore", "pipe", "pipe"], cwd: workspaceDir }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("Claude Code CLI not found on this machine. Install it, then try again."));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Claude Code exited with code ${code}: ${stderr.trim() || "no error output"}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) {
          reject(new Error(parsed.result || "Claude Code reported an error"));
          return;
        }
        resolve(String(parsed.result ?? "").trim() || "(no response)");
      } catch {
        reject(new Error(`Couldn't parse Claude Code output: ${stdout.slice(0, 300)}`));
      }
    });
  });
}
