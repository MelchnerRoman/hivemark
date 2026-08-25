import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

function playwrightCacheDir(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "ms-playwright");
  if (process.platform === "win32") return join(homedir(), "AppData", "Local", "ms-playwright");
  return join(homedir(), ".cache", "ms-playwright");
}

async function isBrowserInstalled(): Promise<boolean> {
  try {
    const entries = await readdir(playwrightCacheDir());
    return entries.some((e) => e.startsWith("chromium-"));
  } catch {
    return false;
  }
}

async function installBrowser(): Promise<void> {
  await execFileAsync("npx", ["-y", "@playwright/mcp@latest", "install-browser", "chrome-for-testing"], {
    timeout: 5 * 60_000,
  });
}

/**
 * MCP tools that need a one-time local setup step beyond just a stored
 * credential. Only "mcp-browser" needs this today (downloading a real
 * Chromium build); tools not listed here are always "ready".
 */
export const MCP_TOOL_SETUP: Record<string, { check: () => Promise<boolean>; install: () => Promise<void> }> = {
  "mcp-browser": { check: isBrowserInstalled, install: installBrowser },
};
