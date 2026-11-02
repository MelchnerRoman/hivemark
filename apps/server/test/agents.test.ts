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
    if (body.system.includes("You are PM,") && !afterTool && JSON.stringify(last).includes("kick off")) {
      return {
        blocks: [
          { tool: "add_todo", input: { text: "Design hero", assignee: "Designer" } },
          { tool: "attach_file", input: { path: "uploads/brief.png" } },
        ],
        stop: "tool_use",
      };
    }
    if (body.system.includes("You are PM,") && afterTool) {
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
  assert.match(first.system, /@Designer/, "teammates listed in the system prompt");
  assert.equal(first.max_tokens, 32000);
  assert.ok(first.tools.some((t: { type?: string }) => t.type?.startsWith("web_search")), "web research granted");
  const lastBlocks = first.messages.at(-1).content;
  assert.equal(lastBlocks[0].type, "image", "attached image sent as an image block");

  const [pmReply] = agentMessages(agentIds.PM);
  assert.deepEqual(JSON.parse(pmReply.attachments), ["uploads/brief.png"]);
  const todo = s.db.prepare("SELECT assignee_id FROM todos WHERE text = 'Design hero'").get() as { assignee_id: string };
  assert.equal(todo.assignee_id, agentIds.Designer);
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
