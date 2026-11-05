// Claude Code sign-out, against a fake `claude` on PATH — never the real CLI,
// which would sign this machine out.
// Run: npm test --workspace=server
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { addMember, startServer, type TestServer } from "./helpers.ts";

const bin = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-fake-claude-"));
const marker = path.join(bin, "logged-out");
fs.writeFileSync(
  path.join(bin, "claude"),
  `#!/usr/bin/env node
const fs = require("fs");
const [cmd, sub] = process.argv.slice(2);
if (cmd === "auth" && sub === "logout") fs.writeFileSync(${JSON.stringify(marker)}, "");
else if (cmd === "auth" && sub === "status") console.log(JSON.stringify({ loggedIn: !fs.existsSync(${JSON.stringify(marker)}), email: "owner@example.com" }));
else process.exit(2);
`,
  { mode: 0o755 }
);

let s: TestServer;
before(async () => {
  s = await startServer({
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "secret",
    PUBLIC_URL: "http://127.0.0.1:1",
    FRONTEND_URL: "http://127.0.0.1:2",
  });
  addMember(s, "m-owner", "owner", "own");
  addMember(s, "m-in", "member", "in");
});
after(async () => {
  await s.stop();
  fs.rmSync(bin, { recursive: true, force: true });
});

test("only the owner can sign Claude Code out", async () => {
  const status = (as: string) => s.req("/api/runtimes/claude-code/status", { as }).then((r) => r.json());
  assert.equal((await status("in")).email, undefined, "members don't see the owner's email");

  assert.equal((await s.req("/api/runtimes/claude-code/logout", { method: "POST", as: "in" })).status, 403);
  assert.equal(fs.existsSync(marker), false);
  assert.equal((await status("own")).loggedIn, true);

  assert.equal((await s.req("/api/runtimes/claude-code/logout", { method: "POST", as: "own" })).status, 200);
  assert.equal((await status("own")).loggedIn, false);
});
