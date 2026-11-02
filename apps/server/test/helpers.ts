import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const SERVER_DIR = path.join(import.meta.dirname, "..");

export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export type TestServer = {
  url: string;
  dataDir: string;
  db: Database.Database;
  /** fetch against the server, optionally as a session token. */
  req: (p: string, init?: RequestInit & { as?: string }) => Promise<Response>;
  stop: () => Promise<void>;
};

/** Boots the real server (src/index.ts via tsx) on a free port against a
 * fresh temp data dir — never the developer's apps/server/data. */
export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemark-test-"));
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), HIVEMARK_DATA_DIR: dataDir, ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {}
    if (i > 100) throw new Error("test server didn't start");
    await new Promise((r) => setTimeout(r, 100));
  }
  const db = new Database(path.join(dataDir, "hivemark.db"));
  return {
    url,
    dataDir,
    db,
    req: (p, init = {}) => {
      const { as, ...rest } = init;
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(rest.headers as Record<string, string>) };
      if (as) headers.Authorization = `Bearer ${as}`;
      return fetch(`${url}${p}`, { ...rest, headers });
    },
    stop: async () => {
      db.close();
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      });
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Adds a signed-in member (session token = `token`) to a server's DB. */
export function addMember(server: TestServer, id: string, role: "owner" | "member", token: string) {
  server.db
    .prepare("INSERT OR REPLACE INTO members (id, name, initials, color, role) VALUES (?,?,?,?,?)")
    .run(id, id, "X", "#000", role);
  server.db.prepare("INSERT OR REPLACE INTO sessions VALUES (?,?,?,?)").run(token, id, "2026-01-01", "2099-01-01");
}

/** What the mock's models API lists, newest first. */
export const MOCK_MODELS = [
  { type: "model", id: "claude-opus-9", display_name: "Claude Opus 9", created_at: "2027-01-01T00:00:00Z" },
  { type: "model", id: "claude-sonnet-9-1", display_name: "Claude Sonnet 9.1", created_at: "2027-01-01T00:00:00Z" },
];

type MockBlock = { text: string } | { tool: string; input: Record<string, unknown> };
export type MockAnthropic = {
  url: string;
  requests: any[];
  close: () => void;
};

/** A local stand-in for the Anthropic Messages API (streaming SSE). `script`
 * picks the reply per request; every request body is recorded. */
export async function startMockAnthropic(
  script: (body: any) => { blocks: MockBlock[]; stop: string }
): Promise<MockAnthropic> {
  const requests: any[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: MOCK_MODELS, has_more: false, first_id: null, last_id: null }));
        return;
      }
      const body = JSON.parse(raw);
      requests.push(body);
      const { blocks, stop } = script(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type: string, d: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`);
      ev("message_start", {
        message: { id: `msg_${++n}`, type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } },
      });
      blocks.forEach((b, index) => {
        if ("text" in b) {
          ev("content_block_start", { index, content_block: { type: "text", text: "" } });
          ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
        } else {
          ev("content_block_start", { index, content_block: { type: "tool_use", id: `toolu_${n}_${index}`, name: b.tool, input: {} } });
          ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
        }
        ev("content_block_stop", { index });
      });
      ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
      ev("message_stop", {});
      res.end();
    });
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${port}`, requests, close: () => server.close() };
}

/** GET with the path sent byte-for-byte. fetch() follows the URL standard
 * and resolves %2e%2e as ".." client-side, so traversal attempts would
 * never reach the server — real attackers use raw HTTP. */
export function rawGet(baseUrl: string, rawPath: string, headers: Record<string, string> = {}): Promise<number> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: rawPath, headers }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end();
  });
}

export async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

// 1x1 PNG
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
);
