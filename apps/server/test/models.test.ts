// Unit tests for model name -> API id resolution. Run: npm test --workspace=server
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.HIVEMARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-test-"));
const { resolveModelId } = await import("../src/modelIds.ts");

test("display names map to API ids without a hardcoded table", () => {
  assert.equal(resolveModelId("Claude Sonnet 5.5"), "claude-sonnet-5-5");
  assert.equal(resolveModelId("Claude Opus 4.8"), "claude-opus-4-8");
  assert.equal(resolveModelId("Claude Haiku 4.5"), "claude-haiku-4-5");
  assert.equal(resolveModelId("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(resolveModelId(""), "claude-sonnet-5-5"); // no list fetched yet
});
