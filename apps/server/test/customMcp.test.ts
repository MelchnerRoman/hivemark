// Owner-added custom MCP servers, end to end against a real stdio MCP server
// (test/fixtures/echoMcpServer.mjs) and a mock Anthropic API.
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { addMember, startMockAnthropic, startServer, waitFor, type MockAnthropic, type TestServer } from "./helpers.ts";

const SECRET = "s3cr3t-value-xyz";
const TOOL_ID = "mcp-custom-echo";
let s: TestServer;
let mock: MockAnthropic;
let agentId: string;

const body = {
  slug: "echo",
  name: "Echo",
  description: "Echoes",
  kind: "stdio",
  command: process.execPath,
  args: [path.join(import.meta.dirname, "fixtures", "echoMcpServer.mjs"), "hello-arg"],
  secrets: { ECHO_SECRET: SECRET },
};

before(async () => {
  mock = await startMockAnthropic((req) => {
    const last = req.messages.at(-1);
    const afterTool = Array.isArray(last.content) && last.content.some((b: { type: string }) => b.type === "tool_result");
    if (!afterTool && req.tools?.some((t: { name: string }) => t.name === `${TOOL_ID}__echo`)) {
      return { blocks: [{ tool: `${TOOL_ID}__echo`, input: { text: "ping" } }], stop: "tool_use" };
    }
    return { blocks: [{ text: "done" }], stop: "end_turn" };
  });
  s = await startServer({
    ANTHROPIC_BASE_URL: mock.url,
    // Must never reach the custom server's env.
    ANTHROPIC_API_KEY: "sk-ant-should-not-leak",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "secret",
    PUBLIC_URL: "http://127.0.0.1:1",
    FRONTEND_URL: "http://127.0.0.1:2",
  });
  addMember(s, "m-owner", "owner", "own");
  addMember(s, "m-in", "member", "in");
  s.db.prepare("INSERT INTO rooms (id, name, emoji, member_ids) VALUES ('room-a','A','a','[\"m-owner\",\"m-in\"]')").run();
  s.db
    .prepare("INSERT INTO task_rooms (id, room_id, name, emoji, status, member_ids) VALUES ('tr-a','room-a','A','a','open','[\"m-owner\",\"m-in\"]')")
    .run();
  await s.req("/api/connections/anthropic", { method: "PUT", as: "own", body: JSON.stringify({ value: "sk-ant-test" }) });
  const res = await s.req("/api/agents", {
    method: "POST",
    as: "own",
    body: JSON.stringify({ taskRoomId: "tr-a", name: "Echoer", instructions: "", color: "#000", avatarEmoji: "x", model: "x", runtimeId: "runtime-hivemark" }),
  });
  agentId = (await res.json()).id;
});
after(async () => {
  await s.stop();
  mock.close();
});

const state = async (as: string) => (await s.req("/api/state", { as })).text();

test("members can't create, edit or delete custom servers", async () => {
  assert.equal((await s.req("/api/mcp-servers", { method: "POST", as: "in", body: JSON.stringify(body) })).status, 403);
  assert.equal((await s.req(`/api/mcp-servers/${TOOL_ID}`, { method: "PUT", as: "in", body: JSON.stringify(body) })).status, 403);
  assert.equal((await s.req(`/api/mcp-servers/${TOOL_ID}`, { method: "DELETE", as: "in" })).status, 403);
  assert.equal(s.db.prepare("SELECT COUNT(*) c FROM mcp_custom_servers").get().c, 0);
});

test("input is validated", async () => {
  for (const bad of [
    { ...body, slug: "../x" },
    { ...body, slug: "Echo" },
    { ...body, command: "" },
    { ...body, args: "nope" },
    { ...body, args: [1] },
    { ...body, kind: "http", url: "file:///etc/passwd" },
    { ...body, secrets: { "BAD NAME": "x" } },
    { ...body, kind: "ws" },
  ]) {
    assert.equal((await s.req("/api/mcp-servers", { method: "POST", as: "own", body: JSON.stringify(bad) })).status, 400, JSON.stringify(bad));
  }
});

test("owner adds a stdio server, grants it, and an agent turn calls it", async () => {
  const res = await s.req("/api/mcp-servers", { method: "POST", as: "own", body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: TOOL_ID });
  assert.equal((await s.req("/api/mcp-servers", { method: "POST", as: "own", body: JSON.stringify(body) })).status, 409);

  // Encrypted at rest, like connections.
  const row = s.db.prepare("SELECT secrets FROM mcp_custom_servers WHERE id = ?").get(TOOL_ID) as { secrets: string };
  assert.ok(!row.secrets.includes(SECRET));

  // Never in /api/state — owner sees only the names; members not even the command.
  const ownerState = await state("own");
  const memberState = await state("in");
  assert.ok(!ownerState.includes(SECRET) && !memberState.includes(SECRET));
  const ownerTool = JSON.parse(ownerState).mcpTools.find((t: { id: string }) => t.id === TOOL_ID);
  assert.deepEqual(ownerTool.custom, { kind: "stdio", command: body.command, args: body.args, secretNames: ["ECHO_SECRET"] });
  const memberTool = JSON.parse(memberState).mcpTools.find((t: { id: string }) => t.id === TOOL_ID);
  assert.deepEqual(memberTool.custom, { kind: "stdio" });

  await s.req(`/api/agents/${agentId}/tools/${TOOL_ID}`, { method: "PATCH", as: "own" });
  await s.req("/api/task-rooms/tr-a/messages", { method: "POST", as: "own", body: JSON.stringify({ content: "@Echoer go" }) });
  await waitFor(() => s.db.prepare("SELECT 1 FROM messages WHERE author_id = ?").get(agentId), 20000);

  assert.ok(mock.requests[0].tools.some((t: { name: string }) => t.name === `${TOOL_ID}__echo`), "custom tool offered to the model");
  const result = mock.requests[1].messages.at(-1).content.find((b: { type: string }) => b.type === "tool_result");
  const text = JSON.stringify(result.content);
  assert.match(text, /echo:ping/, "tool call reached the server");
  assert.match(text, /secret:ok/, "stored env passed to the server");
  assert.match(text, /anthropic:clean/, "server's own env not leaked");
  assert.match(text, /arg:hello-arg/);
});

test("update keeps secrets unless given; delete removes it and its grants", async () => {
  const { secrets: _omit, slug: _slug, ...rest } = body;
  assert.equal((await s.req(`/api/mcp-servers/${TOOL_ID}`, { method: "PUT", as: "own", body: JSON.stringify({ ...rest, name: "Echo 2" }) })).status, 200);
  const tool = JSON.parse(await state("own")).mcpTools.find((t: { id: string }) => t.id === TOOL_ID);
  assert.equal(tool.name, "Echo 2");
  assert.deepEqual(tool.custom.secretNames, ["ECHO_SECRET"]);
  // Switching kind without re-entering secrets would turn env vars into headers.
  assert.equal(
    (await s.req(`/api/mcp-servers/${TOOL_ID}`, { method: "PUT", as: "own", body: JSON.stringify({ ...rest, kind: "http", url: "https://x.test/mcp" }) })).status,
    400
  );

  assert.equal((await s.req(`/api/mcp-servers/${TOOL_ID}`, { method: "DELETE", as: "own" })).status, 200);
  const after = JSON.parse(await state("own"));
  assert.ok(!after.mcpTools.some((t: { id: string }) => t.id === TOOL_ID));
  assert.ok(!after.agents.find((a: { id: string }) => a.id === agentId).grants.some((g: { toolId: string }) => g.toolId === TOOL_ID));
  assert.equal((await s.req(`/api/mcp-servers/${TOOL_ID}`, { method: "DELETE", as: "own" })).status, 404);
  assert.equal((await s.req("/api/mcp-servers/mcp-github", { method: "DELETE", as: "own" })).status, 404, "built-ins aren't deletable");
});
