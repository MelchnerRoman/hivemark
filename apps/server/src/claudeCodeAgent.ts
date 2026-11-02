import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolveModelId } from "./modelIds.js";
import { getAgentWorkspaceDir, getRoomProjectDir, hasBashAccess } from "./agentSandbox.js";
import type { Agent } from "./types.js";
import type { HistoryMessage } from "./claudeAgent.js";

// Built-in tools exposed when an agent has real Bash access granted.
const BASH_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
// The same Hivemark grants API agents get, mapped onto Claude Code's own
// tools — so an agent running on someone's Claude subscription can do the
// same work: read what people attach (always, in a Room), write deliverables
// ("Files"), and research ("Web research"). No shell without bash-access.
const READ_TOOLS = ["Read", "Glob", "Grep"];
const WRITE_TOOLS = ["Write", "Edit"];
const WEB_TOOLS = ["WebSearch", "WebFetch"];

/**
 * Runs a turn by spawning the actual Claude Code CLI (`claude -p`) instead of
 * calling the Anthropic API ourselves. Auth is whatever's already configured
 * for the CLI on this machine (OAuth login or ANTHROPIC_API_KEY) — Hivemark's
 * own stored Anthropic connection key is not used here.
 *
 * Tools follow the agent's grants (see the constants above); Bash
 * additionally needs the server-wide opt-in (agentSandbox.ts). IMPORTANT: Claude Code's headless mode has its full built-in
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
  roomId: string | null,
  signal: AbortSignal
): Promise<string> {
  const transcript = history.map((m) => `${m.role === "assistant" ? "You" : "Message"}: ${m.content}`).join("\n\n");
  const prompt = `${transcript}\n\nRespond with your next message only, no preamble.`;

  const bashAccess = hasBashAccess(agent);
  const granted = (toolId: string) => agent.grants.some((g) => g.toolId === toolId);
  // Without Bash, file tools only make sense inside a Room's project folder
  // (that's where attachments and deliverables live); a DM gets none.
  const workspaceDir = roomId ? getRoomProjectDir(roomId) : bashAccess ? getAgentWorkspaceDir(agent.id) : null;
  const tools = bashAccess
    ? [...BASH_TOOLS]
    : workspaceDir
      ? [...READ_TOOLS, ...(granted("mcp-filesystem") ? WRITE_TOOLS : [])]
      : [];
  if (granted("web-research")) tools.push(...WEB_TOOLS);

  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        // Prompt goes over stdin, not argv: a long room would otherwise hit
        // the OS argument-size limit (E2BIG, 128 KB per arg on Linux).
        "-p",
        "--system-prompt",
        system,
        "--model",
        resolveModelId(agent.model),
        "--output-format",
        "json",
        "--tools",
        tools.join(","),
        ...(workspaceDir ? ["--add-dir", workspaceDir, "--permission-mode", "acceptEdits"] : []),
        // Headless -p can't prompt for approval — pre-approve the web tools.
        ...(granted("web-research") ? ["--allowedTools", WEB_TOOLS.join(",")] : []),
      ],
      { stdio: ["pipe", "pipe", "pipe"], cwd: workspaceDir ?? tmpdir(), signal }
    );
    child.stdin.on("error", () => {}); // EPIPE if the CLI dies early — surfaced via 'close'/'error' below
    child.stdin.end(prompt);

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
