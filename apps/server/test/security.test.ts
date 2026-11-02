// Regression tests for security fixes. Run: npm test --workspace=server
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addMember, PNG, rawGet, startMockAnthropic, startServer, waitFor, type MockAnthropic, type TestServer } from "./helpers.ts";

describe("auth disabled (local mode)", () => {
  let s: TestServer;
  before(async () => {
    s = await startServer();
  });
  after(() => s.stop());

  test("preview-static can't escape the project folder", async () => {
    for (const p of ["..%2fhivemark.db", "%2e%2e/hivemark.db", "..%2f..%2fpackage.json"]) {
      assert.notEqual(await rawGet(s.url, `/preview-static/room-platform/${p}`), 200, p);
    }
    assert.equal(await rawGet(s.url, "/preview-static/..%2fhivemark.db"), 404);
    assert.equal(await rawGet(s.url, "/preview-static/%2e%2e/hivemark.db"), 404);
  });

  test("room/agent ids can't be used as path traversal on the file routes", async () => {
    // Owner (= everyone, with auth off) passes the membership check, so the
    // id itself must be rejected before it becomes a path.
    // %2e%2e (bare "..", no trailing slash) is the dangerous form: unguarded,
    // it lists the data dir itself (hivemark.db, secret.key).
    for (const p of [
      "/api/rooms/%2e%2e/project/files?path=",
      "/api/rooms/%2e%2e/project/files/download?path=hivemark.db",
      "/api/rooms/%2e%2e/project/files/content?path=hivemark.db",
      "/api/rooms/..%2f/project/files?path=",
    ]) {
      assert.notEqual(await rawGet(s.url, p), 200, p);
    }
  });

  test("chat uploads aren't public; SVGs can't run script", async () => {
    const put = (p: string, body: Buffer | string) =>
      s.req(`/api/rooms/room-platform/project/upload?path=${p}`, {
        method: "PUT",
        body,
        headers: { "Content-Type": "application/octet-stream" },
      });
    assert.equal((await put("uploads/a.png", PNG)).status, 200);
    assert.equal((await put("logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>")).status, 200);
    const base = `${s.url}/preview-static/room-platform`;
    for (const p of ["uploads/a.png", "Uploads/a.png", "%75ploads/a.png", "x/..%2Fuploads/a.png", "x/%2e%2e/uploads/a.png"]) {
      assert.equal(await rawGet(s.url, `/preview-static/room-platform/${p}`), 404, p);
    }
    const svg = await fetch(`${base}/logo.svg`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    // members still get uploads through the authenticated route
    assert.equal((await s.req("/api/rooms/room-platform/project/files/download?path=uploads/a.png")).status, 200);
  });

  test("uploads never silently overwrite", async () => {
    const put = (q: string) =>
      s.req(`/api/rooms/room-platform/project/upload?path=dup.txt${q}`, {
        method: "PUT",
        body: "x",
        headers: { "Content-Type": "application/octet-stream" },
      });
    assert.equal((await put("")).status, 200);
    assert.equal((await put("")).status, 409);
    assert.equal((await put("&overwrite=1")).status, 200);
  });

  test("DNS rebinding: foreign Host header is refused", async () => {
    assert.equal(await rawGet(s.url, "/api/state", { Host: "attacker.example" }), 403);
    assert.equal(await rawGet(s.url, "/api/state"), 200);
  });

  test("attachments must exist in the project folder", async () => {
    const res = await s.req("/api/task-rooms/tr-onboarding/messages", {
      method: "POST",
      body: JSON.stringify({ content: "x", attachments: ["../../secret.key"] }),
    });
    assert.equal(res.status, 400);
  });
});

describe("auth enabled (multi-user)", () => {
  let s: TestServer;
  let mock: MockAnthropic;
  let agentId: string;
  before(async () => {
    mock = await startMockAnthropic(() => ({ blocks: [{ text: "ok" }], stop: "end_turn" }));
    s = await startServer({
      ANTHROPIC_BASE_URL: mock.url,
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "secret",
      PUBLIC_URL: "http://127.0.0.1:1",
      FRONTEND_URL: "http://127.0.0.1:2",
    });
    addMember(s, "m-owner", "owner", "own");
    addMember(s, "m-in", "member", "in");
    addMember(s, "m-out", "member", "out");
    // room A: owner + m-in; room B: m-out only
    s.db.prepare("INSERT INTO rooms (id, name, emoji, member_ids) VALUES ('room-a','A','a','[\"m-owner\",\"m-in\"]')").run();
    s.db.prepare("INSERT INTO rooms (id, name, emoji, member_ids) VALUES ('room-b','B','b','[\"m-out\"]')").run();
    s.db
      .prepare("INSERT INTO task_rooms (id, room_id, name, emoji, status, member_ids) VALUES ('tr-a','room-a','A','a','open','[\"m-owner\",\"m-in\"]')")
      .run();
    s.db
      .prepare("INSERT INTO task_rooms (id, room_id, name, emoji, status, member_ids) VALUES ('tr-b','room-b','B','b','open','[\"m-out\"]')")
      .run();
    const res = await s.req("/api/agents", {
      method: "POST",
      as: "in",
      body: JSON.stringify({ taskRoomId: "tr-a", name: "Secret", instructions: "", color: "#000", avatarEmoji: "x", model: "x", runtimeId: "runtime-hivemark" }),
    });
    agentId = (await res.json()).id;
  });
  after(async () => {
    await s.stop();
    mock.close();
  });

  test("a non-member can't add themselves to a room", async () => {
    const res = await s.req("/api/rooms/room-a/members", { method: "POST", as: "out", body: JSON.stringify({ memberId: "m-out" }) });
    assert.equal(res.status, 403);
  });

  test("only the owner changes workspace credentials", async () => {
    const body = JSON.stringify({ value: "sk-evil" });
    assert.equal((await s.req("/api/connections/anthropic", { method: "PUT", as: "in", body })).status, 403);
    assert.equal((await s.req("/api/connections/anthropic", { method: "PUT", as: "own", body })).status, 200);
  });

  test("agents (and @mentions, DMs) are invisible outside their rooms", async () => {
    const state = await (await s.req("/api/state", { as: "out" })).json();
    assert.equal(state.agents.some((a: { id: string }) => a.id === agentId), false);
    const msg = await (
      await s.req("/api/task-rooms/tr-b/messages", { method: "POST", as: "out", body: JSON.stringify({ content: "@Secret do it" }) })
    ).json();
    assert.deepEqual(msg.mentionedAgentIds, []);
    assert.equal((await s.req(`/api/agents/${agentId}/dm`, { method: "POST", as: "out", body: JSON.stringify({ content: "hi" }) })).status, 404);
    assert.equal((await s.req(`/api/agents/${agentId}/files`, { as: "out" })).status, 403);
    // attaching it to a room you're in doesn't work either
    assert.equal((await s.req("/api/rooms/room-b/agents", { method: "POST", as: "out", body: JSON.stringify({ agentId }) })).status, 403);
  });

  test("teams: creator or owner can delete, nobody else", async () => {
    const create = (as: string) =>
      s.req("/api/agent-teams", { method: "POST", as, body: JSON.stringify({ name: "t", agentIds: [], mode: "x" }) }).then((r) => r.json());
    const team = await create("in");
    assert.equal((await s.req(`/api/agent-teams/${team.id}`, { method: "DELETE", as: "out" })).status, 403);
    assert.equal((await s.req(`/api/agent-teams/${team.id}`, { method: "DELETE", as: "in" })).status, 200);
    const other = await create("in");
    assert.equal((await s.req(`/api/agent-teams/${other.id}`, { method: "DELETE", as: "own" })).status, 200);
  });

  test("DMs are private per member — in the UI, the API, and the agent's memory", async () => {
    // agentId lives in tr-a, which both the owner and m-in can see
    const dm = (as: string, content: string) =>
      s.req(`/api/agents/${agentId}/dm`, { method: "POST", as, body: JSON.stringify({ content }) }).then((r) => r.json());
    const mine = await dm("in", "secret plan from m-in");
    await waitFor(() => mock.requests.some((r) => JSON.stringify(r.messages).includes("secret plan")));
    await dm("own", "hello from the owner");
    await waitFor(() => mock.requests.some((r) => JSON.stringify(r.messages).includes("hello from the owner")));

    const ownerReq = mock.requests.find((r) => JSON.stringify(r.messages).includes("hello from the owner"));
    assert.ok(!JSON.stringify(ownerReq.messages).includes("secret plan"), "agent doesn't see other members' threads");

    const ownerState = await (await s.req("/api/state", { as: "own" })).json();
    assert.ok(!JSON.stringify(ownerState.directMessages).includes("secret plan"), "not even the owner sees it");
    const inState = await (await s.req("/api/state", { as: "in" })).json();
    assert.ok(JSON.stringify(inState.directMessages).includes("secret plan"));

    assert.equal((await s.req(`/api/direct-messages/${mine.id}`, { method: "DELETE", as: "own" })).status, 404);
    assert.equal((await s.req(`/api/direct-messages/${mine.id}`, { method: "PATCH", as: "own", body: JSON.stringify({ content: "x" }) })).status, 404);
  });

  test("login CSRF: OAuth callback needs the state cookie of this browser", async () => {
    const hop = await fetch(`${s.url}/api/auth/google/login`, { redirect: "manual" });
    assert.match(hop.headers.get("location") ?? "", /\/api\/auth\/google\/login\?hop=1$/);
    const login = await fetch(`${s.url}/api/auth/google/login?hop=1`, { redirect: "manual" });
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    assert.match(login.headers.get("set-cookie") ?? "", new RegExp(`hm_oauth_state=${state}`));
    const noCookie = await fetch(`${s.url}/api/auth/google/callback?state=${state}&code=x`, { redirect: "manual" });
    assert.equal(noCookie.status, 400);
  });
});
