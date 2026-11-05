import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ClaudeCodeAuthStatus = {
  available: boolean;
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
};

function parseStatus(stdout: string): ClaudeCodeAuthStatus {
  try {
    const parsed = JSON.parse(stdout);
    return {
      available: true,
      loggedIn: !!parsed.loggedIn,
      email: parsed.email,
      subscriptionType: parsed.subscriptionType,
    };
  } catch {
    return { available: true, loggedIn: false };
  }
}

/** Real, read-only check — never touches the CLI's stored credentials. */
export async function getClaudeCodeAuthStatus(): Promise<ClaudeCodeAuthStatus> {
  try {
    const { stdout } = await execFileAsync("claude", ["auth", "status", "--json"]);
    return parseStatus(stdout);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    if (e.code === "ENOENT") return { available: false, loggedIn: false };
    return parseStatus(e.stdout ?? "");
  }
}

/**
 * Fires the real `claude auth login` — this opens the user's actual browser
 * to Anthropic's real OAuth consent page and, once approved, writes real
 * credentials into the CLI's own config on this machine. Detached + fire-
 * and-forget: the frontend re-polls status afterward rather than us blocking
 * this request on however long the user takes in their browser.
 */
export function triggerClaudeCodeLogin(): void {
  const child = spawn("claude", ["auth", "login"], { stdio: "ignore", detached: true });
  child.unref();
}

/** Real `claude auth logout`: removes the CLI's stored credentials on this
 * machine, so Claude Code agents stop working until someone signs in again. */
export async function claudeCodeLogout(): Promise<void> {
  await execFileAsync("claude", ["auth", "logout"], { timeout: 15_000 });
}
