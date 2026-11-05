// Agent workflow tests against a mock Anthropic API (no real model calls).
// Run: npm test --workspace=server
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MOCK_MODELS, PNG, startMockAnthropic, startServer, waitFor, type MockAnthropic, type TestServer } from "./helpers.ts";

let s: TestServer;
let mock: MockAnthropic;
const agentIds: Record<string, string> = {};

before(async () => {
  // PM: on a fresh turn adds a todo for Designer and attaches the brief, then
  // hands off with @Designer. Everyone else just answers.
  mock = await startMockAnthropic((body) => {
    const last = body.messages.at(-1);
    const afterTool = Array.isArray(last.content) && last.content.some((b: { type: string }) => b.type === "tool_result");
    if (body.system[0].text.includes("You are PM,") && !afterTool && JSON.stringify(last).includes("kick off")) {
      return {
        blocks: [
          { tool: "add_todo", input: { text: "Design hero", assignee: "Designer" } },
          { tool: "attach_file", input: { path: "uploads/brief.png" } },
        ],
        stop: "tool_use",
      };
    }
    if (body.system[0].text.includes("You are PM,") && afterTool) {
      return { blocks: [{ text: "Plan ready. @Designer please design the hero." }], stop: "end_turn" };
    }
    return { blocks: [{ text: "On it." }], stop: "end_turn" };
  });
  s = await startServer({ ANTHROPIC_BASE_URL: mock.url });
  await s.req("/api/connections/anthropic", { method: "PUT", body: JSON.stringify({ value: "sk-ant-test" }) });
  for (const name of ["PM", "Designer"]) {
    const res = await s.req("/api/agents", {
      method: "POST",
      body: JSON.stringify({
        taskRoomId: "tr-onboarding",
        name,
        instructions: `${name} role`,
        color: "#000",
        avatarEmoji: "x",
        model: "Claude Sonnet 5.5",
        runtimeId: "runtime-hivemark",
        toolIds: name === "PM" ? ["web-research"] : [],
      }),
    });
    agentIds[name] = (await res.json()).id;
  }
});
after(async () => {
  await s.stop();
  mock.close();
});

const agentMessages = (id: string) =>
  s.db.prepare("SELECT content, attachments FROM messages WHERE author_id = ? ORDER BY created_at").all(id) as {
    content: string;
    attachments: string;
  }[];

test("brief with an image -> PM plans, attaches, hands off to Designer", async () => {
  await s.req("/api/rooms/room-platform/project/upload?path=uploads/brief.png", {
    method: "PUT",
    body: PNG,
    headers: { "Content-Type": "application/octet-stream" },
  });
  await s.req("/api/task-rooms/tr-onboarding/messages", {
    method: "POST",
    body: JSON.stringify({ content: "@PM kick off the hero work", attachments: ["uploads/brief.png"] }),
  });

  await waitFor(() => agentMessages(agentIds.Designer).length > 0);

  const first = mock.requests[0];
  assert.match(first.system[0].text, /@Designer/, "teammates listed in the system prompt");
  assert.equal(first.max_tokens, 32000);
  assert.ok(first.tools.some((t: { type?: string }) => t.type?.startsWith("web_search")), "web research granted");
  const lastBlocks = first.messages.at(-1).content;
  assert.equal(lastBlocks[0].type, "image", "attached image sent as an image block");

  const [pmReply] = agentMessages(agentIds.PM);
  assert.deepEqual(JSON.parse(pmReply.attachments), ["uploads/brief.png"]);
  const todo = s.db.prepare("SELECT assignee_id FROM todos WHERE text = 'Design hero'").get() as { assignee_id: string };
  assert.equal(todo.assignee_id, agentIds.Designer);
});

test("prompt caching: breakpoints on tools, system and the last message (moving with each tool round)", () => {
  const [first, second] = mock.requests.filter((r) => r.system[0].text.includes("You are PM,"));
  const marked = (r: any) =>
    r.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.cache_control).length;
  for (const r of [first, second]) {
    assert.deepEqual(r.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(r.tools.at(-1).cache_control, { type: "ephemeral" });
    assert.deepEqual(r.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" });
    assert.equal(marked(r), 1, "one message breakpoint, never piling up");
  }
});

test("Run when the agent's own reply is the latest message doesn't send an assistant-last conversation", async () => {
  const before = mock.requests.length;
  await s.req(`/api/agents/${agentIds.Designer}/run`, { method: "POST" });
  await waitFor(() => mock.requests.length > before);
  const req = mock.requests.at(-1);
  assert.equal(req.messages[0].role, "user");
  assert.equal(req.messages.at(-1).role, "user");
});

test("the model list comes from the provider", async () => {
  const { models } = await (await s.req("/api/models?provider=anthropic")).json();
  assert.deepEqual(models, MOCK_MODELS.map((m) => m.display_name));
});

test("replacing the Anthropic key refetches the model list (cache is per key)", async () => {
  const list = async () => (await (await s.req("/api/models?provider=anthropic")).json()).models;
  mock.models = [{ ...MOCK_MODELS[0], id: "claude-other-1", display_name: "Claude Other 1" }];
  assert.deepEqual(await list(), MOCK_MODELS.map((m) => m.display_name), "same key: still cached");
  await s.req("/api/connections/anthropic", { method: "PUT", body: JSON.stringify({ value: "sk-ant-test-2" }) });
  assert.deepEqual(await list(), ["Claude Other 1"]);
  mock.models = MOCK_MODELS;
  await s.req("/api/connections/anthropic", { method: "PUT", body: JSON.stringify({ value: "sk-ant-test" }) });
  assert.deepEqual(await list(), MOCK_MODELS.map((m) => m.display_name));
});

test("a single message over the history budget still reaches the agent (cut off)", async () => {
  const before = mock.requests.length;
  await s.req("/api/task-rooms/tr-onboarding/messages", {
    method: "POST",
    body: JSON.stringify({ content: `@Designer HUGE-BRIEF ${"x".repeat(450_000)}` }),
  });
  await waitFor(() => mock.requests.length > before);
  const sent = JSON.stringify(mock.requests.at(-1).messages);
  assert.match(sent, /HUGE-BRIEF/);
  assert.match(sent, /message cut off here/);
});

test("an over-budget room keeps the same cut across turns (stable cached prefix)", async () => {
  // 30 × 20k chars of history, then two turns that each add another 20k.
  const insert = s.db.prepare(
    "INSERT INTO messages (id, task_room_id, author_type, author_id, content, created_at) VALUES (?, 'tr-onboarding', 'member', 'x', ?, ?)"
  );
  for (let i = 0; i < 30; i++) insert.run(`filler-${i}`, "y".repeat(20_000), new Date(Date.now() + i).toISOString());
  await new Promise((r) => setTimeout(r, 50));
  const firsts: unknown[] = [];
  for (const n of [1, 2]) {
    const before = mock.requests.length;
    const replies = agentMessages(agentIds.Designer).length;
    await s.req("/api/task-rooms/tr-onboarding/messages", {
      method: "POST",
      body: JSON.stringify({ content: `@Designer turn ${n} ${"z".repeat(20_000)}` }),
    });
    await waitFor(() => mock.requests.length > before && agentMessages(agentIds.Designer).length > replies);
    firsts.push(mock.requests.at(-1).messages[0]);
  }
  assert.match(JSON.stringify(firsts[0]), /older message\(s\)/);
  assert.deepEqual(firsts[1], firsts[0]);
});
