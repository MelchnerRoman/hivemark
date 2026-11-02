// Which folders an agent's file tool can reach. Run: npm test --workspace=server
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-test-"));
process.env.HIVEMARK_DATA_DIR = dataDir;
const { MCP_TOOL_REGISTRY } = await import("../src/mcp/registry.ts");
const fsTool = MCP_TOOL_REGISTRY["mcp-filesystem"];
const roots = (roomId: string | null, dmMemberId: string | null) =>
  fsTool.kind === "http" ? [] : fsTool.args(null, "agent-a", roomId, dmMemberId).filter((a) => a.startsWith(dataDir));

test("in a DM the file tool only reaches that member's DM folder", () => {
  assert.deepEqual(roots(null, "m-1"), [path.join(dataDir, "dm-workspaces", "agent-a", "m-1")]);
});

test("in a room it reaches the room project and the agent's workspace, never DM folders", () => {
  const r = roots("room-x", null);
  assert.equal(r.length, 2);
  assert.ok(r.every((dir) => !dir.includes("dm-workspaces")));
});
