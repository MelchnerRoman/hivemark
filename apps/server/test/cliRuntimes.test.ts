// Tool traces from the CLI runtimes, against fake `claude` / `npx` (codex-acp)
// / `goose` binaries on PATH (no real CLIs, no model calls).
// Run: npm test --workspace=server
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startServer, waitFor, type TestServer } from "./helpers.ts";

const bin = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-fake-cli-"));
const fake = (name: string, body: string) =>
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env node\n${body}`, { mode: 0o755 });
const lines = (events: object[]) => `process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(${JSON.stringify(events.map((e) => JSON.stringify(e)).join("\n") + "\n")}));`;

// Claude Code --output-format stream-json --verbose, abridged.
fake(
  "claude",
  `if (!process.argv.includes("stream-json") || !process.argv.includes("--verbose")) process.exit(2);\n` +
  lines([
    { type: "system", subtype: "init", session_id: "s" },
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "brief.md" } },
          { type: "tool_use", id: "t2", name: "mcp__hivemark__attach_file", input: { path: "out.md" } },
        ],
      },
    },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
    { type: "result", subtype: "success", is_error: false, result: "Claude Code done." },
  ])
);
// goose run --output-format stream-json, as goose 1.57 printed it.
fake(
  "goose",
  lines([
    { type: "message", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Looking." }] } },
    {
      type: "message",
      message: { id: "m1", role: "assistant", content: [{ type: "toolRequest", id: "t", toolCall: { status: "success", value: { name: "shell", arguments: { command: "ls" } } } }] },
    },
    { type: "message", message: { id: "u1", role: "user", content: [{ type: "toolResponse", id: "t", toolResult: { status: "success", value: {} } }] } },
    { type: "message", message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Goose done." }] } },
    { type: "complete", total_tokens: 4 },
  ])
);
// codex-acp: initialize, session/new, then a prompt that reports a tool call.
fake(
  "npx",
  `let buf = "";
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
const update = (u) => send({ method: "session/update", params: { sessionId: "s1", update: u } });
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.method === "initialize") send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} } });
    else if (msg.method === "session/new") send({ id: msg.id, result: { sessionId: "s1" } });
    else if (msg.method === "session/prompt") {
      update({ sessionUpdate: "tool_call", toolCallId: "c1", title: "Run ls", kind: "execute", status: "pending", rawInput: { command: ["ls"] } });
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Codex done." } });
      send({ id: msg.id, result: { stopReason: "end_turn" } });
    }
  }
});`
);

let s: TestServer;
const ids: Record<string, string> = {};
before(async () => {
  s = await startServer({ PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  await s.req("/api/connections/anthropic", { method: "PUT", body: JSON.stringify({ value: "sk-ant-test" }) }); // goose needs one
  for (const [name, runtimeId] of [
    ["CC", "runtime-claude-code"],
    ["Cx", "runtime-codex"],
    ["Gs", "runtime-goose"],
  ]) {
    const res = await s.req("/api/agents", {
      method: "POST",
      body: JSON.stringify({ taskRoomId: "tr-onboarding", name, instructions: "", color: "#000", avatarEmoji: "x", model: "", runtimeId, toolIds: [] }),
    });
    ids[name] = (await res.json()).id;
  }
});
after(() => s.stop());

async function reply(name: string) {
  await s.req("/api/task-rooms/tr-onboarding/messages", { method: "POST", body: JSON.stringify({ content: `@${name} go` }) });
  const row = await waitFor(
    () => s.db.prepare("SELECT content, meta FROM messages WHERE author_id = ?").get(ids[name]) as { content: string; meta: string | null } | undefined,
    20000
  );
  return { content: row.content, meta: row.meta && JSON.parse(row.meta) };
}

test("Claude Code: stream-json tool_use blocks become the reply's tool trace", async () => {
  assert.deepEqual(await reply("CC"), {
    content: "Claude Code done.",
    meta: { tools: [{ name: "Read", input: '{"file_path":"brief.md"}' }, { name: "attach_file", input: '{"path":"out.md"}' }] },
  });
});

test("Codex: ACP tool_call updates become the reply's tool trace", async () => {
  assert.deepEqual(await reply("Cx"), { content: "Codex done.", meta: { tools: [{ name: "Run ls", input: '{"command":["ls"]}' }] } });
});

test("Goose: stream-json toolRequest blocks become the reply's tool trace", async () => {
  assert.deepEqual(await reply("Gs"), { content: "Looking.\n\nGoose done.", meta: { tools: [{ name: "shell", input: '{"command":"ls"}' }] } });
});
