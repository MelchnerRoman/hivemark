import type { ConnectionKey } from "../types.js";

/**
 * Static config for each entry in our MCP tool catalog (mcp-github, mcp-linear,
 * mcp-postgres, mcp-browser, mcp-slack). Two shapes:
 *  - "server": a real MCP server we spawn over stdio (via @modelcontextprotocol/sdk).
 *  - "custom": no MCP server exists/is worth spawning for this; we implement the
 *    handful of operations directly as in-process tools calling the service's
 *    REST API ourselves, using the same stored connection credential.
 */
export type ServerToolConfig = {
  kind: "server";
  connectionKey: ConnectionKey | null; // null = no credential required (e.g. browser)
  command: string;
  args: (credential: string | null) => string[];
  env?: (credential: string | null) => Record<string, string>;
};

export type CustomToolConfig = {
  kind: "custom";
  connectionKey: ConnectionKey;
};

export const MCP_TOOL_REGISTRY: Record<string, ServerToolConfig | CustomToolConfig> = {
  "mcp-browser": {
    kind: "server",
    connectionKey: null,
    command: "npx",
    args: () => ["-y", "@playwright/mcp@latest", "--headless"],
  },
  "mcp-github": {
    kind: "server",
    connectionKey: "github",
    command: "npx",
    args: () => ["-y", "@modelcontextprotocol/server-github"],
    env: (credential) => (credential ? { GITHUB_PERSONAL_ACCESS_TOKEN: credential } : {}) as Record<string, string>,
  },
  "mcp-postgres": {
    kind: "server",
    connectionKey: "postgres",
    command: "npx",
    args: (credential) => ["-y", "@modelcontextprotocol/server-postgres", credential ?? ""],
  },
  "mcp-slack": {
    kind: "custom",
    connectionKey: "slack",
  },
  "mcp-linear": {
    kind: "custom",
    connectionKey: "linear",
  },
};
