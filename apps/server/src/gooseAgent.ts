import { spawn } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentWorkspaceDir, getDmWorkspaceDir, getRoomProjectDir, hasBashAccess } from "./agentSandbox.js";
import { baseEnv, mcpServersFor } from "./claudeCodeAgent.js";
import { repo } from "./db.js";
import { resolveModelId } from "./modelIds.js";
import type { Agent } from "./types.js";
import type { HistoryMessage } from "./claudeAgent.js";

/**
 * Runs a turn through the real Goose CLI (`goose run`), reusing Hivemark's
 * stored Anthropic key for auth (passed as ANTHROPIC_API_KEY) since Goose
 * supports Anthropic as a standard provider. `--no-session` keeps each turn
 * a fresh one-shot call — we feed the full history back in as text each
 * time, same as every other runtime here, rather than relying on Goose's
 * own session persistence.
 *
 * Sandboxing, matching Claude Code's (claudeCodeAgent.ts): by default goose
 * offers the model its built-in `developer` extension (shell, write, edit)
 * plus apps/extensionmanager/delegate — verified against goose 1.57 with a
 * mock provider. `--no-profile` drops all of those (only `load_skill`
 * remains), and HOME points at an empty per-turn dir so the user's own
 * ~/.config/goose (extensions, skills, secrets) is never loaded. The
 * developer builtin comes back only with the bash grant, with cwd = the same
 * workspace dir Claude Code would use. NOTE: unlike Claude Code, goose's
 * shell is not confined to that dir — cwd is a default, not a jail.
 * Granted MCP servers are the ones Claude Code gets (mcpServersFor).
 */
export function runGooseTurn(
  agent: Agent,
  system: string,
  history: HistoryMessage[],
  roomId: string | null,
  signal: AbortSignal,
  turnToken: string | null,
  dmMemberId: string | null = null,
  traceTool: (name: string, input: unknown) => void = () => {}
): Promise<string> {
  const apiKey = repo.getConnectionValue("anthropic");
  if (!apiKey) {
    return Promise.reject(
      new Error(
        "Goose needs an Anthropic API key to run. Add one in Agent settings → Connections, then try again."
      )
    );
  }

  const transcript = history.map((m) => `${m.role === "assistant" ? "You" : "Message"}: ${m.content}`).join("\n\n");
  const prompt = `${transcript}\n\nRespond with your next message only, no preamble.`;

  const bashAccess = hasBashAccess(agent);
  // Goose's HOME for this turn: its config/state/logs land here, then go.
  const home = fs.mkdtempSync(path.join(tmpdir(), "hivemark-goose-"));
  const cwd = !bashAccess
    ? home
    : roomId
      ? getRoomProjectDir(roomId)
      : dmMemberId
        ? getDmWorkspaceDir(agent.id, dmMemberId)
        : getAgentWorkspaceDir(agent.id);

  const extensionArgs: string[] = [];
  for (const [name, server] of Object.entries(mcpServersFor(agent, roomId, turnToken))) {
    if (server.type === "http") {
      // ponytail: goose's CLI flag takes a URL only — servers needing auth
      // headers are left out; add them via a goose config file if needed.
      if (!Object.keys(server.headers).length) extensionArgs.push("--with-streamable-http-extension", server.url);
      continue;
    }
    // Goose hands stdio extensions its own env (incl. ANTHROPIC_API_KEY), and
    // `--with-extension` takes env values in argv (visible to every local
    // user) — so each server starts from a private launcher script under
    // `env -i`: exactly the env mcpServersFor chose, nothing secret in argv.
    const script = path.join(home, `${name}.sh`);
    const lines = [
      ...Object.entries(server.env).map(([k, v]) => `export ${shq(k)}=${shq(v)}`),
      `exec ${[server.command, ...server.args].map(shq).join(" ")}`,
    ];
    fs.writeFileSync(script, lines.join("\n") + "\n", { mode: 0o600 });
    extensionArgs.push("--with-extension", `${name}:/usr/bin/env -i /bin/sh ${shq(script)}`);
  }

  // Minimal env: what goose needs to start plus its provider auth — not the
  // server's whole environment.
  const env: Record<string, string> = {
    ...baseEnv(),
    HOME: home,
    ANTHROPIC_API_KEY: apiKey,
    GOOSE_DISABLE_KEYRING: "1", // no macOS keychain reads/prompts
    GOOSE_DISABLE_SESSION_NAMING: "true", // saves a model call per turn
    ...(process.env.ANTHROPIC_HOST ? { ANTHROPIC_HOST: process.env.ANTHROPIC_HOST } : {}),
  };

  return new Promise((resolve, reject) => {
    const child = spawn(
      "goose",
      [
        "run",
        "--no-profile",
        ...(bashAccess ? ["--with-builtin", "developer"] : []),
        ...extensionArgs,
        "--no-session",
        "--provider",
        "anthropic",
        "--model",
        resolveModelId(agent.model),
        "--system",
        system,
        // Prompt over stdin, not argv (OS argument-size limit, see claudeCodeAgent.ts).
        "-i",
        "-",
        // NDJSON of goose's own messages (text, toolRequest, error blocks) —
        // shape checked against goose 1.57 driven by a local mock provider.
        "--output-format",
        "stream-json",
        "--quiet",
      ],
      { stdio: ["pipe", "pipe", "pipe"], cwd, env, signal }
    );
    child.stdin.on("error", () => {}); // EPIPE if goose dies early — surfaced via 'close'/'error' below
    child.stdin.end(prompt);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("Goose CLI not found on this machine. Install it, then try again."));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      fs.rmSync(home, { recursive: true, force: true });
      if (code !== 0) {
        reject(new Error(`Goose exited with code ${code}: ${stderr.trim() || "no error output"}`));
        return;
      }
      // Text of every assistant message, as text mode printed it; a message
      // can arrive in several chunks under one id.
      let text = "";
      let lastId: string | undefined;
      let error: string | null = null;
      for (const line of stdout.split("\n")) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "error") error = String(ev.error);
        const msg = ev.type === "message" ? ev.message : null;
        if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
        for (const b of msg.content) {
          if (b.type === "text") {
            if (text && msg.id !== lastId) text += "\n\n";
            text += b.text;
            lastId = msg.id;
          } else if (b.type === "toolRequest" && b.toolCall?.value) traceTool(b.toolCall.value.name.replace(/^hivemark__/, ""), b.toolCall.value.arguments);
          else if (b.type === "error") error ??= String(b.message);
        }
      }
      // goose has exited 0 on a provider/auth failure before (then printing
      // "Ran into this error: ..." in text mode) — an error event or block
      // fails the turn either way, so agent status stays accurate.
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(text.trim() || "(no response)");
    });
  });
}

/** POSIX single-quoting, for the launcher scripts above. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
