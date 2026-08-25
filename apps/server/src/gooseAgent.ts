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
export function runGooseTurn(agent: Agent, system: string, history: HistoryMessage[]): Promise<string> {
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
        "-t",
        prompt,
        "--output-format",
        "text",
        "--quiet",
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ANTHROPIC_API_KEY: apiKey } }
    );

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
      const text = stdout.trim();
      if (code !== 0) {
        reject(new Error(`Goose exited with code ${code}: ${stderr.trim() || "no error output"}`));
        return;
      }
      // ponytail: goose exits 0 even on a provider/auth failure and just prints
      // "Ran into this error: ..." to stdout — verified directly against the real
      // CLI, not a guess. Treat that prefix as a failure so agent status stays
      // accurate; upgrade to a real machine-readable error signal if goose adds one.
      if (text.startsWith("Ran into this error:")) {
        reject(new Error(text));
        return;
      }
      resolve(text || "(no response)");
    });
  });
}
