// Regression tests for security fixes. Run: npm test --workspace=server
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

  test("the seeded demo loop is paused, so a fresh install makes no LLM call on its own", async () => {
    const state = await (await s.req("/api/state")).json();
    const loop = state.loops.find((l: { id: string }) => l.id === "loop-funnel-check");
    assert.equal(loop.active, false);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM loops WHERE active = 1").get().n, 0);
  });

  test("DNS rebinding: foreign Host header is refused", async () => {
    assert.equal(await rawGet(s.url, "/api/state", { Host: "attacker.example" }), 403);
    assert.equal(await rawGet(s.url, "/api/state"), 200);
  });

  test("the Claude Code tool bridge only answers our own children", async () => {
    // no internal token -> refused, whatever the turn token
    assert.equal((await s.req("/internal/turns/anything/tools")).status, 403);
    assert.equal((await s.req("/internal/turns/anything/tools/add_todo", { method: "POST", body: "{}" })).status, 403);
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
  let held: Promise<void> = Promise.resolve();
  let agentId: string;
  before(async () => {
    // A request whose conversation says HOLD stays in flight until release().
    mock = await startMockAnthropic(async (body) => {
      if (JSON.stringify(body.messages).includes("HOLD")) await held;
      return { blocks: [{ text: "ok" }], stop: "end_turn" };
    });
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

  test("members get no key hints and no agent ids from rooms they can't see", async () => {
    s.db.prepare("INSERT INTO agent_teams (id, name, mode, agent_ids) VALUES ('team-mixed','M','auto',?)").run(JSON.stringify([agentId]));
    const state = async (as: string) => (await s.req("/api/state", { as })).json();
    const [own, inS, out] = await Promise.all([state("own"), state("in"), state("out")]);
    const anthropic = (st: { connections: { key: string; connected: boolean; hint: string | null }[] }) =>
      st.connections.find((c) => c.key === "anthropic")!;
    assert.equal(anthropic(own).hint, "evil");
    for (const st of [inS, out]) {
      assert.equal(anthropic(st).connected, true);
      assert.ok(st.connections.every((c: { hint: string | null }) => c.hint === null));
    }
    const team = (st: { agentTeams: { id: string; agentIds: string[] }[] }) => st.agentTeams.find((t) => t.id === "team-mixed");
    assert.deepEqual(team(own)?.agentIds, [agentId]);
    assert.deepEqual(team(inS)?.agentIds, [agentId]);
    assert.equal(team(out), undefined, "a team of only invisible agents is left out");
    s.db.prepare("DELETE FROM agent_teams WHERE id = 'team-mixed'").run();
  });

  test("/api/state only carries messages from task rooms the caller can see", async () => {
    for (const tr of ["tr-a", "tr-b"]) {
      s.db
        .prepare("INSERT INTO messages (id, task_room_id, author_type, author_id, content, created_at) VALUES (?,?,?,?,?,?)")
        .run(`scope-${tr}`, tr, "member", "m-owner", `hello ${tr}`, "2026-01-01T00:00:00Z");
    }
    const ids = async (as: string) =>
      ((await (await s.req("/api/state", { as })).json()).messages as { id: string }[]).map((m) => m.id).filter((id) => id.startsWith("scope-"));
    assert.deepEqual(await ids("in"), ["scope-tr-a"]);
    assert.deepEqual(await ids("out"), ["scope-tr-b"]);
    assert.deepEqual((await ids("own")).sort(), ["scope-tr-a", "scope-tr-b"]);
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

  test("agent name/instructions edits: task room members only, validated", async () => {
    const patch = (as: string, body: object) => s.req(`/api/agents/${agentId}/config`, { method: "PATCH", as, body: JSON.stringify(body) });
    assert.equal((await patch("out", { instructions: "pwned" })).status, 403);
    assert.equal((await patch("in", { name: "  " })).status, 400);
    assert.equal((await patch("in", { instructions: 42 })).status, 400);
    assert.equal((await patch("in", { name: " Secret ", instructions: "TOP-SECRET-PLAN" })).status, 200);
    const row = s.db.prepare("SELECT name, instructions, model FROM agents WHERE id = ?").get(agentId);
    assert.deepEqual(row, { name: "Secret", instructions: "TOP-SECRET-PLAN", model: "x" }, "omitted fields kept");
  });

  test("members see who wrote a message in their room, not the hidden agent's details", async () => {
    s.db
      .prepare("INSERT INTO messages (id, task_room_id, author_type, author_id, content, created_at) VALUES (?,?,?,?,?,?)")
      .run("by-secret", "tr-b", "agent", agentId, "hi from Secret", "2026-01-01T00:00:00Z");
    const out = await (await s.req("/api/state", { as: "out" })).json();
    assert.equal(out.agents.some((a: { id: string }) => a.id === agentId), false);
    assert.deepEqual(out.messageAuthors, [{ id: agentId, name: "Secret", color: "#000", avatarEmoji: "x" }]);
    assert.doesNotMatch(JSON.stringify(out), /TOP-SECRET-PLAN/);
    // an agent that never wrote in a visible room isn't listed
    const inS = await (await s.req("/api/state", { as: "in" })).json();
    assert.deepEqual(inS.messageAuthors, []);
    s.db.prepare("DELETE FROM messages WHERE id = 'by-secret'").run();
    assert.deepEqual((await (await s.req("/api/state", { as: "out" })).json()).messageAuthors, []);
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

  test("Stop only cancels the caller's own DM turns, not other members' (queued or running)", async () => {
    const dm = (as: string, content: string) =>
      s.req(`/api/agents/${agentId}/dm`, { method: "POST", as, body: JSON.stringify({ content }) });
    const stop = (as: string) => s.req(`/api/agents/${agentId}/stop`, { method: "POST", as });
    const sent = (text: string) => mock.requests.some((r) => JSON.stringify(r.messages).includes(text));
    const agentReplies = (memberId: string) =>
      (s.db.prepare("SELECT COUNT(*) n FROM direct_messages WHERE agent_id = ? AND member_id = ? AND author_type = 'agent'").get(agentId, memberId) as { n: number }).n;

    // m-in's DM runs; the owner's queues behind it. m-in stops: theirs aborts, the owner's still runs.
    let release!: () => void;
    held = new Promise((r) => (release = r));
    await dm("in", "HOLD running from m-in");
    await waitFor(() => sent("HOLD running from m-in"));
    await dm("own", "queued from owner");
    assert.equal((await stop("in")).status, 200);
    await waitFor(() => sent("queued from owner"));
    release();

    // the owner's DM runs; m-in stops: it keeps running and gets its reply.
    const before = agentReplies("m-owner");
    held = new Promise((r) => (release = r));
    await dm("own", "HOLD running from owner");
    await waitFor(() => sent("HOLD running from owner"));
    assert.equal((await stop("in")).status, 200);
    release();
    await waitFor(() => agentReplies("m-owner") > before);
  });

  test("incremental /api/state: only changes, only visible rooms, full again when access changes", async () => {
    const state = (as: string, cursor?: { seq: number; scope: string }) =>
      s
        .req(cursor ? `/api/state?since=${cursor.seq}&scope=${encodeURIComponent(cursor.scope)}` : "/api/state", { as })
        .then((r) => r.json());
    const post = (as: string, tr: string, content: string) =>
      s.req(`/api/task-rooms/${tr}/messages`, { method: "POST", as, body: JSON.stringify({ content }) }).then((r) => r.json());

    const first = await state("in");
    assert.equal(first.sync.delta, false);
    await post("own", "tr-a", "delta-visible");
    await post("out", "tr-b", "delta-hidden");
    const d1 = await state("in", first.sync);
    assert.equal(d1.sync.delta, true);
    assert.deepEqual(d1.messages.map((m: { content: string }) => m.content), ["delta-visible"], "only the new, visible message");

    const msg = d1.messages[0];
    await s.req(`/api/messages/${msg.id}`, { method: "PATCH", as: "own", body: JSON.stringify({ content: "delta-edited" }) });
    const d2 = await state("in", d1.sync);
    assert.deepEqual(d2.messages.map((m: { content: string }) => m.content), ["delta-edited"]);
    await s.req(`/api/messages/${msg.id}`, { method: "DELETE", as: "own" });
    const d3 = await state("in", d2.sync);
    assert.deepEqual(d3.messages, []);
    assert.deepEqual(d3.sync.deleted.messages, [msg.id]);

    // m-out joins room A: their old cursor must not hide room A's older messages
    const outBefore = await state("out");
    await post("own", "tr-a", "older room-a message");
    s.db.prepare("UPDATE rooms SET member_ids = '[\"m-owner\",\"m-in\",\"m-out\"]' WHERE id = 'room-a'").run();
    s.db.prepare("UPDATE task_rooms SET member_ids = '[\"m-owner\",\"m-in\",\"m-out\"]' WHERE id = 'tr-a'").run();
    const outAfter = await state("out", outBefore.sync);
    assert.equal(outAfter.sync.delta, false, "scope changed -> full state");
    assert.ok(outAfter.messages.some((m: { content: string }) => m.content === "older room-a message"));
    // and a forged scope is just ignored (full state, still scoped)
    const forged = await state("out", { seq: outAfter.sync.seq, scope: `owner:m-owner` });
    assert.equal(forged.sync.delta, false);
  });

  test("files from a DM are private to that member; room files aren't affected", async () => {
    const dmDir = path.join(s.dataDir, "dm-workspaces", agentId, "m-in");
    fs.mkdirSync(dmDir, { recursive: true });
    fs.writeFileSync(path.join(dmDir, "dm-secret.txt"), "only m-in");
    const list = async (as: string, dm: boolean) =>
      (await (await s.req(`/api/agents/${agentId}/files${dm ? "?dm=1" : ""}`, { as })).json()).files.map((f: { path: string }) => f.path);
    assert.deepEqual(await list("in", true), ["dm-secret.txt"]);
    assert.deepEqual(await list("own", true), [], "not even the owner");
    assert.ok(!(await list("in", false)).includes("dm-secret.txt"), "not in the agent's shared workspace");
    const dl = (as: string) => s.req(`/api/agents/${agentId}/files/download?path=dm-secret.txt&dm=1`, { as });
    assert.equal((await dl("in")).status, 200);
    assert.equal((await dl("own")).status, 404);
  });

  test("login CSRF: OAuth callback needs the state cookie of this browser", async () => {
    const hop = await fetch(`${s.url}/api/auth/google/login`, { redirect: "manual" });
    assert.match(hop.headers.get("location") ?? "", /\/api\/auth\/google\/login\?hop=1$/);
    // the desktop app's return address survives the hop through PUBLIC_URL
    const desktopHop = await fetch(`${s.url}/api/auth/google/login?return=${encodeURIComponent("http://127.0.0.1:4011/")}`, { redirect: "manual" });
    assert.match(desktopHop.headers.get("location") ?? "", /hop=1&return=http%3A%2F%2F127\.0\.0\.1%3A4011%2F$/);
    const login = await fetch(`${s.url}/api/auth/google/login?hop=1`, { redirect: "manual" });
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    assert.match(login.headers.get("set-cookie") ?? "", new RegExp(`hm_oauth_state=${state}`));
    const noCookie = await fetch(`${s.url}/api/auth/google/callback?state=${state}&code=x`, { redirect: "manual" });
    assert.equal(noCookie.status, 400);
  });
});
