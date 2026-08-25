import crypto from "node:crypto";

/** Minted once per server boot, never persisted. Shared only with our own
 * spawned MCP-server children (see mcp/registry.ts's "mcp-preview" entry) so
 * they can call back into this same process's /internal/* routes — those
 * routes bypass normal member auth (a child process has no session token),
 * so this token plus a loopback check (see index.ts) is the only gate. */
export const INTERNAL_TOKEN = crypto.randomBytes(32).toString("hex");
