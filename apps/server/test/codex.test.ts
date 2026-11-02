// listCodexModels against a fake `npx` (no real Codex CLI, no model calls).
// Run: npm test --workspace=server
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.HIVEMARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-test-"));
process.env.HIVEMARK_CODEX_MODELS_TIMEOUT_MS = "1000";
const bin = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-fake-npx-"));
const spawnLog = path.join(bin, "spawns.log");
// Fake codex-acp: answers initialize + session/new with one model, or hangs
// when FAKE_CODEX_HANG is set. Every spawn appends a line to spawns.log.
fs.writeFileSync(
  path.join(bin, "npx"),
  `#!/usr/bin/env node
require("fs").appendFileSync(${JSON.stringify(spawnLog)}, "x\\n");
if (process.env.FAKE_CODEX_HANG) setInterval(() => {}, 1e6);
else {
  let buf = "";
  process.stdin.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const result = msg.method === "initialize"
        ? { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} }
        : { sessionId: "s1", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gpt-fake", options: [{ value: "gpt-fake", name: "GPT Fake" }] }] };
      setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n"), 200);
    }
  });
}
`,
  { mode: 0o755 }
);
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const { listCodexModels } = await import("../src/codexAgent.ts");
const spawns = () => (fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, "utf8").split("\n").length - 1 : 0);

test("a hung codex-acp times out instead of holding /api/models open forever", async () => {
  process.env.FAKE_CODEX_HANG = "1";
  const outcome = await Promise.race([
    listCodexModels().then(() => "resolved", () => "rejected"),
    new Promise((r) => setTimeout(() => r("hung"), 5000)),
  ]);
  delete process.env.FAKE_CODEX_HANG;
  assert.equal(outcome, "rejected");
});

test("concurrent cold requests share one codex-acp process; a failure isn't cached", async () => {
  const before = spawns();
  const [a, b] = await Promise.all([listCodexModels(), listCodexModels()]);
  assert.deepEqual(a, ["gpt-fake"]);
  assert.deepEqual(b, ["gpt-fake"]);
  assert.equal(spawns() - before, 1);
});
