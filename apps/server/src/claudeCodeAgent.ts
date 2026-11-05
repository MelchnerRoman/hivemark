import { spawn } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repo } from "./db.js";
import { resolveModelId } from "./modelIds.js";
import { getAgentWorkspaceDir, getDmWorkspaceDir, getRoomProjectDir, hasBashAccess, TOOL_ACCESS_ENABLED } from "./agentSandbox.js";
import { firstPartyServer, resolveMcpTool } from "./mcp/registry.js";
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

// What a stdio MCP server needs to start (npx needs PATH) — not relying on
// the CLI to merge its own environment in.
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "USER", "LANG", "TMPDIR"]) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}

/** MCP servers for this turn, in Claude Code's --mcp-config shape: our own
 * workspace tools (via the per-turn bridge, task-room turns only) plus the
 * agent's granted catalog tools, under the same credential / opt-in rules
 * the API runtimes apply (mcp/manager.ts). "Files" is skipped — on this
 * runtime it's Claude Code's own Read/Write (above). */
function mcpServersFor(agent: Agent, roomId: string | null, turnToken: string | null): Record<string, object> {
  const servers: Record<string, object> = {};
  if (turnToken) {
    servers.hivemark = { type: "stdio", ...firstPartyServer("workspaceMcpServer", [], { ...baseEnv(), HIVEMARK_TURN_TOKEN: turnToken }) };
  }
  for (const { toolId } of agent.grants) {
    const config = resolveMcpTool(toolId);
    if (!config || toolId === "mcp-filesystem") continue;
    if (toolId === "mcp-preview" && (!TOOL_ACCESS_ENABLED || !roomId)) continue;
    const credential = config.connectionKey ? repo.getConnectionValue(config.connectionKey) : null;
    if (config.connectionKey && !credential) continue;
    servers[toolId] =
      config.kind === "http"
        ? { type: "http", url: config.url, headers: config.headers(credential) }
        : {
            type: "stdio",
            command: config.command,
            args: config.args(credential, agent.id, roomId, null), // filesystem is skipped above
            env: { ...baseEnv(), ...(config.env?.(credential) ?? {}) },
          };
  }
  return servers;
}

/** Claude Code's `mcp__<server>__<tool>` as the Hivemark runtime names it:
 * our own workspace tools bare, catalog tools as `<toolId>__<tool>`. */
function traceName(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return !m ? name : m[1] === "hivemark" ? m[2] : `${m[1]}__${m[2]}`;
}

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
  signal: AbortSignal,
  turnToken: string | null,
  dmMemberId: string | null = null,
  traceTool: (name: string, input: unknown) => void = () => {}
): Promise<string> {
  const transcript = history.map((m) => `${m.role === "assistant" ? "You" : "Message"}: ${m.content}`).join("\n\n");
  const prompt = `${transcript}\n\nRespond with your next message only, no preamble.`;

  const bashAccess = hasBashAccess(agent);
  const granted = (toolId: string) => agent.grants.some((g) => g.toolId === toolId);
  // The Room's project folder (attachments, deliverables), or in a DM that
  // member's private DM folder — never shared with a room or another DM.
  const workspaceDir = roomId
    ? getRoomProjectDir(roomId)
    : dmMemberId
      ? getDmWorkspaceDir(agent.id, dmMemberId)
      : bashAccess
        ? getAgentWorkspaceDir(agent.id)
        : null;
  const tools = bashAccess
    ? [...BASH_TOOLS]
    : workspaceDir
      ? [...READ_TOOLS, ...(granted("mcp-filesystem") ? WRITE_TOOLS : [])]
      : [];
  if (granted("web-research")) tools.push(...WEB_TOOLS);

  // Config goes in a private temp file, not argv: it can hold credentials
  // (GitHub token, Postgres URL), and argv is visible to every local user.
  const servers = mcpServersFor(agent, roomId, turnToken);
  const configDir = fs.mkdtempSync(path.join(tmpdir(), "hivemark-mcp-"));
  const configPath = path.join(configDir, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });
  // Headless -p can't prompt for approval — pre-approve what we granted.
  const allowed = [...(granted("web-research") ? WEB_TOOLS : []), ...Object.keys(servers).map((name) => `mcp__${name}`)];

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
        // stream-json (needs --verbose with -p) also reports each tool call,
        // for the reply's tool trace; the final text is in its "result" event.
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        tools.join(","),
        ...(workspaceDir ? ["--add-dir", workspaceDir, "--permission-mode", "acceptEdits"] : []),
        // --strict-mcp-config: only our servers — never the MCP servers from
        // the user's personal Claude Code config on this machine.
        "--mcp-config",
        configPath,
        "--strict-mcp-config",
        ...(allowed.length ? ["--allowedTools", allowed.join(",")] : []),
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
      fs.rmSync(configDir, { recursive: true, force: true });
      if (code !== 0) {
        reject(new Error(`Claude Code exited with code ${code}: ${stderr.trim() || "no error output"}`));
        return;
      }
      // NDJSON: assistant events carry the tool_use blocks, the last line is
      // the "result" event (same fields --output-format json used to print).
      let parsed: { is_error?: boolean; result?: string } | null = null;
      for (const line of stdout.split("\n")) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "result") parsed = ev;
        if (ev.type !== "assistant" || !Array.isArray(ev.message?.content)) continue;
        for (const b of ev.message.content) if (b.type === "tool_use") traceTool(traceName(b.name), b.input);
      }
      if (!parsed) {
        reject(new Error(`Couldn't parse Claude Code output: ${stdout.slice(0, 300)}`));
        return;
      }
      if (parsed.is_error) {
        reject(new Error(parsed.result || "Claude Code reported an error"));
        return;
      }
      resolve(String(parsed.result ?? "").trim() || "(no response)");
    });
  });
}
