import path from "node:path";
import type { ConnectionKey } from "../types.js";
import { getAgentWorkspaceDir, getRoomProjectDir } from "../agentSandbox.js";
import { INTERNAL_TOKEN } from "../internalAuth.js";

/**
 * Static config for each entry in our MCP tool catalog. Two shapes:
 *  - "stdio": a real MCP server we spawn as a local process (via @modelcontextprotocol/sdk).
 *  - "http": a real MCP server hosted remotely, spoken to over Streamable HTTP
 *    (e.g. Linear's official mcp.linear.app endpoint).
 */
export type StdioToolConfig = {
  kind: "stdio";
  connectionKey: ConnectionKey | null; // null = no credential required (e.g. browser)
  command: string;
  args: (credential: string | null, agentId: string, roomId: string | null) => string[];
  env?: (credential: string | null) => Record<string, string>;
};

export type HttpToolConfig = {
  kind: "http";
  connectionKey: ConnectionKey;
  url: string;
  headers: (credential: string) => Record<string, string>;
};

// Dev runs this file straight from .ts via tsx (see the root "dev" script);
// a packaged/built server runs compiled .js under dist/ with plain node —
// this file's own extension at runtime is a reliable, Electron-agnostic
// signal for which case we're in (same idiom apps/desktop/src/backend.js
// uses app.isPackaged for, one level up the stack).
const IS_TS_RUNTIME = import.meta.url.endsWith(".ts");
const PREVIEW_SERVER_ENTRY = path.join(import.meta.dirname, IS_TS_RUNTIME ? "previewMcpServer.ts" : "previewMcpServer.js");
const TSX_BIN = path.join(import.meta.dirname, "..", "..", "..", "..", "node_modules", ".bin", "tsx");

/** Launch spec for one of our own MCP server scripts in this directory
 * (same dev-vs-packaged logic as "mcp-preview" below). */
export function firstPartyServer(name: string, args: string[], env: Record<string, string>) {
  return {
    command: IS_TS_RUNTIME ? TSX_BIN : process.execPath,
    args: [path.join(import.meta.dirname, IS_TS_RUNTIME ? `${name}.ts` : `${name}.js`), ...args],
    env: {
      HIVEMARK_INTERNAL_TOKEN: INTERNAL_TOKEN,
      HIVEMARK_INTERNAL_PORT: process.env.PORT ?? "4001",
      ...(IS_TS_RUNTIME ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
      ...env,
    },
  };
}

export const MCP_TOOL_REGISTRY: Record<string, StdioToolConfig | HttpToolConfig> = {
  "mcp-browser": {
    kind: "stdio",
    connectionKey: null,
    command: "npx",
    args: () => ["-y", "@playwright/mcp@latest", "--headless", "--browser", "chromium"],
  },
  "mcp-github": {
    kind: "stdio",
    connectionKey: "github",
    command: "npx",
    args: () => ["-y", "@modelcontextprotocol/server-github"],
    env: (credential) => (credential ? { GITHUB_PERSONAL_ACCESS_TOKEN: credential } : {}) as Record<string, string>,
  },
  "mcp-postgres": {
    kind: "stdio",
    connectionKey: "postgres",
    command: "npx",
    args: (credential) => ["-y", "@modelcontextprotocol/server-postgres", credential ?? ""],
  },
  // Community-maintained, actively updated real MCP server for Slack (the
  // official @modelcontextprotocol/server-slack reference impl is deprecated).
  // Takes a bot token — same credential we already store for "slack".
  "mcp-slack": {
    kind: "stdio",
    connectionKey: "slack",
    command: "npx",
    args: () => ["-y", "slack-mcp-server"],
    env: (credential) => (credential ? { SLACK_MCP_XOXB_TOKEN: credential } : {}) as Record<string, string>,
  },
  // Official filesystem MCP server, confined to two roots (see agentSandbox.ts):
  // the agent's own private workspace, and the current Room's shared project
  // folder — the same folder every other agent (and human, via the Files
  // tab) working in that Room reads and writes. Falls back to the private
  // dir alone in a DM turn, which has no Room. Never the app's own
  // source/data root.
  "mcp-filesystem": {
    kind: "stdio",
    connectionKey: null,
    command: "npx",
    // Room dir listed FIRST when present — @modelcontextprotocol/server-filesystem
    // resolves a bare relative filename against whichever allowed root comes
    // first, and a bare filename ("site.html", not an absolute path) is the
    // overwhelmingly common thing a model actually writes. Verified live:
    // with the private dir first, agents silently wrote into their private
    // folder despite reporting success — reordering fixes the default
    // without needing every agent to always pass an absolute path.
    args: (_credential, agentId, roomId) => [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      ...(roomId ? [getRoomProjectDir(roomId)] : []),
      getAgentWorkspaceDir(agentId),
    ],
  },
  // Our own first-party tool (not a third-party package, unlike every other
  // entry here) — see mcp/previewMcpServer.ts. Lets an agent start/stop/check
  // its Room's live preview by calling back into this same server process
  // over an internal, token-authenticated loopback route (internalAuth.ts).
  // Gated at connect time (mcp/manager.ts) on ENABLE_AGENT_TOOL_ACCESS, same
  // bar as Bash access — arbitrary code execution either way.
  "mcp-preview": {
    kind: "stdio",
    connectionKey: null,
    command: IS_TS_RUNTIME ? TSX_BIN : process.execPath,
    args: (_credential, _agentId, roomId) => (roomId ? [PREVIEW_SERVER_ENTRY, roomId] : []),
    env: () => ({
      HIVEMARK_INTERNAL_TOKEN: INTERNAL_TOKEN,
      HIVEMARK_INTERNAL_PORT: process.env.PORT ?? "4001",
      // Packaged case only (see command above) — process.execPath is
      // Electron's own binary there, and needs this to run a plain script
      // as Node instead of launching another Electron GUI process. Ignored
      // by plain Node in the tsx/dev case.
      ...(IS_TS_RUNTIME ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
    }),
  },
  // Linear's own official MCP server — centrally hosted, no local process.
  // Accepts a personal API key directly as a Bearer token (no OAuth dance needed).
  "mcp-linear": {
    kind: "http",
    connectionKey: "linear",
    url: "https://mcp.linear.app/mcp",
    headers: (credential) => ({ Authorization: `Bearer ${credential}` }),
  },
};
