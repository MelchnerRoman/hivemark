// Unit tests for the post-login redirect allow-list. Run: npm test --workspace=server
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// auth.ts imports db.ts, which opens a database at import time — point it
// at a throwaway folder (each test file runs in its own process).
process.env.HIVEMARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-test-"));
process.env.FRONTEND_URL = "https://app.example.com";
const { allowedReturnTo } = await import("../src/auth.ts");

test("login can return to the web frontend or the desktop app (loopback)", () => {
  assert.equal(allowedReturnTo("https://app.example.com/some/page"), "https://app.example.com/");
  assert.equal(allowedReturnTo("http://127.0.0.1:4011/"), "http://127.0.0.1:4011/");
  assert.equal(allowedReturnTo("http://localhost:3000/x?y=1"), "http://localhost:3000/");
});

test("login never returns anywhere else", () => {
  for (const bad of [
    "https://evil.example/",
    "http://127.0.0.1.evil.example/",
    "https://app.example.com.evil.example/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "//evil.example/",
    "not a url",
    123,
    undefined,
  ]) {
    assert.equal(allowedReturnTo(bad), null, String(bad));
  }
});
