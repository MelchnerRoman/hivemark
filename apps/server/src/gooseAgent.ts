import { spawn } from "node:child_process";
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
 */
export function runGooseTurn(
  agent: Agent,
  system: string,
  history: HistoryMessage[],
  signal: AbortSignal,
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

  return new Promise((resolve, reject) => {
    const child = spawn(
      "goose",
      [
        "run",
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
      { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ANTHROPIC_API_KEY: apiKey }, signal }
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
          } else if (b.type === "toolRequest" && b.toolCall?.value) traceTool(b.toolCall.value.name, b.toolCall.value.arguments);
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
