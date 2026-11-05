// In-chat agent status: which conversation a running agent is replying in
// (Agent.activeTurn), stopping it from chat, and the "Stopped by" trace.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addMember, startMockAnthropic, startServer, waitFor, type MockAnthropic, type TestServer } from "./helpers.ts";

let s: TestServer;
let mock: MockAnthropic;
let agentId: string;
// Each mock request waits until the test releases it — a turn stays "running".
let release: (() => void)[] = [];

before(async () => {
  mock = await startMockAnthropic(async () => {
    await new Promise<void>((r) => release.push(r));
    return { blocks: [{ text: "Done." }], stop: "end_turn" };
  });
  s = await startServer({ ANTHROPIC_BASE_URL: mock.url, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", PUBLIC_URL: "http://127.0.0.1:1", FRONTEND_URL: "http://127.0.0.1:2" });
  addMember(s, "m-owner", "owner", "own");
  addMember(s, "m-a", "member", "a");
  addMember(s, "m-b", "member", "b");
  s.db.prepare(`INSERT INTO rooms (id, name, emoji, member_ids) VALUES ('room-a','A','a','["m-owner","m-a","m-b"]')`).run();
  s.db.prepare(`INSERT INTO task_rooms (id, room_id, name, emoji, status, member_ids) VALUES ('tr-a','room-a','A','a','open','["m-owner","m-a","m-b"]')`).run();
  await s.req("/api/connections/anthropic", { method: "PUT", as: "own", body: JSON.stringify({ value: "sk-ant-test" }) });
  const res = await s.req("/api/agents", {
    method: "POST",
    as: "own",
    body: JSON.stringify({ taskRoomId: "tr-a", name: "Worker", instructions: "", color: "#000", avatarEmoji: "x", model: "x", runtimeId: "runtime-hivemark" }),
  });
  agentId = (await res.json()).id;
});
after(async () => {
  release.forEach((r) => r());
  await s.stop();
  mock.close();
});

const agentAs = async (as: string) =>
  (await (await s.req("/api/state", { as })).json()).agents.find((a: { id: string }) => a.id === agentId);

test("a DM turn's activity is visible only to that member — not other members, not the owner", async () => {
  await s.req(`/api/agents/${agentId}/dm`, { method: "POST", as: "a", body: JSON.stringify({ content: "hi" }) });
  await waitFor(() => release.length > 0);
  assert.deepEqual((await agentAs("a")).activeTurn, { dm: true });
  for (const other of ["b", "own"]) {
    const agent = await agentAs(other);
    assert.equal(agent.status, "running");
    assert.equal(agent.activeTurn, undefined, `${other} must not see another member's DM activity`);
  }

  // Another member can't stop it; its member can, and the DM gets a trace.
  await s.req(`/api/agents/${agentId}/stop`, { method: "POST", as: "b" });
  assert.deepEqual((await agentAs("a")).activeTurn, { dm: true });
  await s.req(`/api/agents/${agentId}/stop`, { method: "POST", as: "a" });
  await waitFor(() => s.db.prepare("SELECT 1 FROM direct_messages WHERE meta IS NOT NULL").get());
  const dms = (await (await s.req("/api/state", { as: "a" })).json()).directMessages;
  const trace = dms.find((m: { meta?: { stoppedBy?: string } }) => m.meta?.stoppedBy);
  assert.equal(trace.content, "Stopped by m-a");
  assert.equal(trace.meta.stoppedBy, "m-a");
  // And it's in no one else's state.
  assert.ok(!(await (await s.req("/api/state", { as: "own" })).text()).includes("Stopped by m-a"));
  assert.equal((await agentAs("a")).activeTurn, undefined);
  release.shift()?.();
});

test("a room turn's activity is shared with the room; stopping leaves a trace the model never sees", async () => {
  const before = mock.requests.length;
  await s.req("/api/task-rooms/tr-a/messages", { method: "POST", as: "a", body: JSON.stringify({ content: "@Worker go" }) });
  await waitFor(() => mock.requests.length > before && release.length > 0);
  for (const as of ["a", "b", "own"]) assert.deepEqual((await agentAs(as)).activeTurn, { taskRoomId: "tr-a" });

  await s.req(`/api/agents/${agentId}/stop`, { method: "POST", as: "b" });
  release.shift()?.();
  const trace = await waitFor(() => s.db.prepare("SELECT content, meta FROM messages WHERE author_id = ?").get(agentId) as { content: string; meta: string });
  assert.equal(trace.content, "Stopped by m-b");
  assert.deepEqual(JSON.parse(trace.meta), { stoppedBy: "m-b" });
  assert.equal((await agentAs("a")).activeTurn, undefined);

  // Next turn: the trace isn't in the model's history.
  const n = mock.requests.length;
  await s.req("/api/task-rooms/tr-a/messages", { method: "POST", as: "a", body: JSON.stringify({ content: "@Worker again" }) });
  await waitFor(() => mock.requests.length > n);
  assert.ok(!JSON.stringify(mock.requests.at(-1).messages).includes("Stopped by"));
  release.shift()?.();
  await waitFor(() => s.db.prepare("SELECT 1 FROM messages WHERE author_id = ? AND content = 'Done.'").get(agentId));
});

test("a member who reaches the agent only via a Room attachment can stop their own DM turn, not its home room's turn", async () => {
  // m-c is in room-c, which the agent is attached to — not in its home task room tr-a.
  addMember(s, "m-c", "member", "c");
  s.db.prepare(`INSERT INTO rooms (id, name, emoji, member_ids) VALUES ('room-c','C','c','["m-owner","m-c"]')`).run();
  s.db.prepare("UPDATE agents SET room_id = 'room-c' WHERE id = ?").run(agentId);
  const stop = () => s.req(`/api/agents/${agentId}/stop`, { method: "POST", as: "c" });
  const dmTraces = () => s.db.prepare("SELECT COUNT(*) n FROM direct_messages WHERE member_id = 'm-c' AND meta IS NOT NULL").get() as { n: number };

  // Their DM turn: stoppable.
  await s.req(`/api/agents/${agentId}/dm`, { method: "POST", as: "c", body: JSON.stringify({ content: "hi" }) });
  await waitFor(() => release.length > 0);
  assert.deepEqual((await agentAs("c")).activeTurn, { dm: true });
  assert.equal((await stop()).status, 200);
  await waitFor(() => dmTraces().n > 0);
  assert.equal((await agentAs("c")).activeTurn, undefined);
  release.shift()?.();

  // The home room's turn: not stoppable by them (nor via stop-all).
  const n = mock.requests.length;
  const done = () => (s.db.prepare("SELECT COUNT(*) n FROM messages WHERE author_id = ? AND content = 'Done.'").get(agentId) as { n: number }).n;
  const doneBefore = done();
  await s.req("/api/task-rooms/tr-a/messages", { method: "POST", as: "a", body: JSON.stringify({ content: "@Worker home" }) });
  await waitFor(() => mock.requests.length > n && release.length > 0);
  assert.equal((await stop()).status, 200);
  assert.equal((await s.req("/api/agents/stop-all", { method: "POST", as: "c" })).status, 200);
  assert.deepEqual((await agentAs("a")).activeTurn, { taskRoomId: "tr-a" });
  assert.equal((await agentAs("a")).status, "running");
  release.shift()?.();
  await waitFor(() => done() > doneBefore);
  s.db.prepare("UPDATE agents SET room_id = NULL WHERE id = ?").run(agentId);
});
