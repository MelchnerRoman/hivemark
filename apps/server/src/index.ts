import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer, type VerifyClientCallbackSync } from "ws";
import { repo } from "./db.js";
import { bus } from "./events.js";
import { findMentionedAgents, runAgentTurn, stopAgentTurn } from "./claudeAgent.js";
import { startScheduler } from "./scheduler.js";
import { getClaudeCodeAuthStatus, triggerClaudeCodeLogin } from "./claudeCodeAuth.js";
import { isCliAvailable } from "./cliCheck.js";
import { MCP_TOOL_SETUP } from "./mcp/setup.js";
import { closeAgentSession, closeAllAgentSessions, startIdleSessionSweep } from "./mcp/manager.js";
import {
  getAgentWorkspaceDir,
  getRoomProjectDir,
  listDir,
  listFilesRecursive,
  readTextFile,
  resolveFileInDir,
  resolveWritePathInDir,
  TOOL_ACCESS_ENABLED,
} from "./agentSandbox.js";
import { getPreviewState, startPreview, stopAllPreviews, stopPreview } from "./projectRunner.js";
import { INTERNAL_TOKEN } from "./internalAuth.js";
import { AUTH_ENABLED, PUBLIC_URL } from "./authConfig.js";
import fs from "node:fs";
import path from "node:path";
import {
  buildAuthorizeUrl,
  completeOAuthLogin,
  exchangeLoginCode,
  getEnabledProviders,
  requireAuth,
  requireAuthForWebSocket,
  verifyState,
  type ProviderName,
} from "./auth.js";
import type { ConnectionKey } from "./types.js";

const PORT = Number(process.env.PORT ?? 4001);
const HOST = process.env.HOST ?? "127.0.0.1";

// Only the app's own local origins may talk to this server — the dev web
// server (localhost:3000) and the packaged Electron build's static-export
// server (127.0.0.1:<ephemeral port>). Blocks arbitrary websites the user
// has open elsewhere from reading responses via cross-origin fetch/XHR.
// ALLOWED_ORIGIN (self-hosting) is additive on top of this, never a replacement —
// local/Electron dev must keep working unmodified regardless of what's configured.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const app = express();
// DNS rebinding: a page on attacker.example re-resolved to 127.0.0.1 is
// same-origin with us, so its GETs carry no Origin header and sail past the
// CORS check below — with auth disabled that's the owner's whole /api/state.
// When bound to loopback, every real client addresses us as a loopback host.
const LOCAL_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const EXTRA_HOSTS = EXTRA_ORIGINS.flatMap((o) => (URL.canParse(o) ? [new URL(o).host] : []));
if (!AUTH_ENABLED && LOCAL_HOST_HEADER.test(HOST)) {
  app.use((req, res, next) => {
    const host = req.headers.host ?? "";
    if (LOCAL_HOST_HEADER.test(host) || EXTRA_HOSTS.includes(host)) return next();
    res.status(403).json({ error: "forbidden host" });
  });
}
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || LOCAL_ORIGIN.test(origin) || EXTRA_ORIGINS.includes(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
    },
  })
);
// 2 MB: a pasted brief or document easily exceeds Express's 100 KB default,
// which would reject the message outright.
app.use(express.json({ limit: "2mb" }));

function handle(fn: (req: express.Request<Record<string, string>>, res: express.Response) => unknown) {
  return async (req: express.Request<Record<string, string>>, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** Guard for task-room-scoped mutating routes — sends the 403 itself and
 * returns false when the caller isn't a member (owner always passes, see
 * repo.isTaskRoomMember). Callers do `if (!requireTaskRoomMember(...)) return;`. */
function requireTaskRoomMember(
  req: express.Request<Record<string, string>>,
  res: express.Response,
  taskRoomId: string
): boolean {
  if (repo.isTaskRoomMember(taskRoomId, req.memberId)) return true;
  res.status(403).json({ error: "You're not a member of this task room." });
  return false;
}

/** Room-level equivalent of requireTaskRoomMember, for the shared project
 * folder's routes below (scoped to a whole Room, not one Task Room in it). */
function requireRoomMember(req: express.Request<Record<string, string>>, res: express.Response, roomId: string): boolean {
  if (repo.isRoomMember(roomId, req.memberId)) return true;
  res.status(403).json({ error: "You're not a member of this room." });
  return false;
}

/** Workspace-wide settings (credentials, defaults, runtimes) — owner only. */
function requireOwner(req: express.Request<Record<string, string>>, res: express.Response): boolean {
  if (repo.getMemberRole(req.memberId) === "owner") return true;
  res.status(403).json({ error: "Only the workspace owner can change this." });
  return false;
}

/** Agent-scoped routes: 404s for an unknown agent, 403s for non-members of
 * its task room. Returns the agent, or null after sending the response. */
function requireAgentAccess(req: express.Request<Record<string, string>>, res: express.Response) {
  const agent = repo.getAgent(req.params.agentId);
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return null;
  }
  return requireTaskRoomMember(req, res, agent.taskRoomId) ? agent : null;
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --- auth (public — must stay registered before app.use(requireAuth) below) ---
app.get("/api/auth/providers", (_req, res) => res.json({ providers: getEnabledProviders() }));

// The state cookie must be set on the same host the provider redirects back
// to (PUBLIC_URL), but the frontend may reach us under another name
// (localhost vs 127.0.0.1, an internal URL, ...). So login always takes one
// hop through PUBLIC_URL first — unconditionally, since comparing Host
// headers would loop behind a proxy that rewrites them.
const STATE_COOKIE = "hm_oauth_state";
function readCookie(req: express.Request, name: string): string | null {
  const match = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
app.get("/api/auth/:provider/login", (req, res) => {
  const provider = req.params.provider as ProviderName;
  if (!getEnabledProviders().includes(provider)) return res.status(404).json({ error: "provider not configured" });
  if (req.query.hop !== "1") return res.redirect(`${PUBLIC_URL}/api/auth/${provider}/login?hop=1`);
  const { url, state } = buildAuthorizeUrl(provider);
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // sent on the provider's top-level redirect back to us
    secure: PUBLIC_URL!.startsWith("https:"),
    maxAge: 10 * 60_000,
    path: "/",
  });
  res.redirect(url);
});

app.get(
  "/api/auth/:provider/callback",
  handle(async (req, res) => {
    const provider = req.params.provider as ProviderName;
    const frontendUrl = process.env.FRONTEND_URL!;
    if (!getEnabledProviders().includes(provider)) return res.status(404).json({ error: "provider not configured" });
    const state = req.query.state as string | undefined;
    const cookieState = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: "/" });
    if (!state || cookieState !== state || !verifyState(state)) {
      return res.status(400).json({ error: "Login session expired or invalid — try signing in again." });
    }
    try {
      const loginCode = await completeOAuthLogin(provider, String(req.query.code ?? ""));
      res.redirect(`${frontendUrl}?code=${loginCode}`);
    } catch (err) {
      console.error("oauth login failed", err);
      res.redirect(`${frontendUrl}?authError=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
    }
  })
);

app.post(
  "/api/auth/exchange",
  handle((req, res) => {
    const token = exchangeLoginCode(String(req.body.code ?? ""));
    if (!token) return res.status(400).json({ error: "That login link expired — try signing in again." });
    res.json({ token });
  })
);

// Serves a Room's static project as a real website, e.g. for an <iframe> or
// "open externally" — deliberately mounted before requireAuth, since a plain
// <iframe src> / new-tab navigation can't attach a bearer token. The content
// served here is exactly what the Room's project is *for* (a site meant to
// be viewed), so this mirrors what would be public once actually deployed.
// Chat uploads (uploads/) also live in the project folder, so agents can read
// them, but they aren't part of the site — members get them through the
// authenticated download route instead. Checked on the real resolved path,
// lowercased, so %-encoding, symlinks or "Uploads/" on a case-insensitive
// disk can't slip past.
const NO_SCRIPT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
app.use("/preview-static/:roomId", (req, res, next) => {
  if (!repo.getRoom(req.params.roomId)) return res.sendStatus(404);
  const dir = getRoomProjectDir(req.params.roomId);
  let target: string;
  try {
    target = path.resolve(dir, "." + decodeURIComponent(req.path));
  } catch {
    return res.sendStatus(400);
  }
  const real = fs.existsSync(target) ? fs.realpathSync(target) : target;
  const rel = path.relative(fs.realpathSync(dir), real).toLowerCase();
  if (rel === "uploads" || rel.startsWith("uploads" + path.sep)) return res.sendStatus(404);
  express.static(dir, {
    // An SVG opened directly is a document that can run script on this
    // origin; as an <img> it never runs script, so this only blocks the former.
    setHeaders: (r, file) => {
      if (file.toLowerCase().endsWith(".svg")) r.setHeader("Content-Security-Policy", NO_SCRIPT_CSP);
    },
  })(req, res, next);
});

// Called only by our own spawned "mcp-preview" MCP-server child processes
// (see mcp/previewMcpServer.ts) — a separate OS process with no member
// session token, so it can't go through the normal requireAuth path below.
// Trust = loopback origin AND the per-boot token the child alone received
// via env; loopback alone would trust any other process on the machine.
function requireInternalToken(req: express.Request, res: express.Response): boolean {
  const remote = req.socket.remoteAddress;
  const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (!isLoopback || req.header("x-internal-token") !== INTERNAL_TOKEN) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}
app.get("/internal/rooms/:roomId/preview/status", (req, res) => {
  if (!requireInternalToken(req, res)) return;
  res.json(getPreviewState(req.params.roomId));
});
app.post("/internal/rooms/:roomId/preview/start", (req, res) => {
  if (!requireInternalToken(req, res)) return;
  res.json(startPreview(req.params.roomId));
});
app.post("/internal/rooms/:roomId/preview/stop", (req, res) => {
  if (!requireInternalToken(req, res)) return;
  res.json(stopPreview(req.params.roomId));
});

app.use(requireAuth);

app.get(
  "/api/auth/me",
  handle((req, res) => {
    const member = repo.getMember(req.memberId);
    if (!member) return res.status(404).json({ error: "member not found" });
    res.json(member);
  })
);

app.delete(
  "/api/auth/session",
  handle((req, res) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (token) repo.deleteSession(token);
    res.json({ ok: true });
  })
);

app.get(
  "/api/state",
  handle(async (req, res) => {
    const state = repo.getScopedState(req.memberId);
    const mcpTools = await Promise.all(
      state.mcpTools.map(async (tool) => {
        const setup = MCP_TOOL_SETUP[tool.id];
        if (!setup) return { ...tool, status: "ready" as const };
        return { ...tool, status: (await setup.check()) ? ("ready" as const) : ("needs_setup" as const) };
      })
    );
    res.json({ ...state, mcpTools });
  })
);

app.post(
  "/api/mcp-tools/:id/install",
  handle(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const setup = MCP_TOOL_SETUP[req.params.id];
    if (!setup) return res.status(400).json({ error: "This tool doesn't need installation." });
    await setup.install();
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- per-agent private files (an agent's own scratch space, granted via the
// "Files" MCP tool) --- Query-param path (not a URL segment) so nested
// output — e.g. an agent-scaffolded "hello-world/src/App.jsx" — downloads
// without needing Express 5's wildcard route syntax.
function listFilesRoute(dirFn: (req: express.Request<Record<string, string>>) => string) {
  return handle((req, res) => {
    if (!requireAgentAccess(req, res)) return;
    const { entries, truncated } = listFilesRecursive(dirFn(req));
    res.json({ files: entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)), truncated });
  });
}
function downloadFileRoute(dirFn: (req: express.Request<Record<string, string>>) => string) {
  return handle((req, res) => {
    if (!requireAgentAccess(req, res)) return;
    const relativePath = String(req.query.path ?? "");
    const filePath = resolveFileInDir(dirFn(req), relativePath);
    if (!filePath) return res.status(404).json({ error: "file not found" });
    res.download(filePath, path.basename(relativePath));
  });
}

app.get(
  "/api/agents/:agentId/files",
  listFilesRoute((req) => getAgentWorkspaceDir(req.params.agentId))
);
app.get(
  "/api/agents/:agentId/files/download",
  downloadFileRoute((req) => getAgentWorkspaceDir(req.params.agentId))
);

// --- room project (the real, shared Finder — every agent and human working
// in a Room reads/writes the same folder here, see getRoomProjectDir) ---
app.get(
  "/api/rooms/:roomId/project/files",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const entries = listDir(getRoomProjectDir(req.params.roomId), String(req.query.path ?? ""));
    if (!entries) return res.status(404).json({ error: "folder not found" });
    res.json(entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)));
  })
);
app.get(
  "/api/rooms/:roomId/project/files/content",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const result = readTextFile(getRoomProjectDir(req.params.roomId), String(req.query.path ?? ""));
    if (!result) return res.status(404).json({ error: "file not found" });
    res.json(result);
  })
);
app.get(
  "/api/rooms/:roomId/project/files/download",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const relativePath = String(req.query.path ?? "");
    const filePath = resolveFileInDir(getRoomProjectDir(req.params.roomId), relativePath);
    if (!filePath) return res.status(404).json({ error: "file not found" });
    res.download(filePath, path.basename(relativePath));
  })
);
app.post(
  "/api/rooms/:roomId/project/files",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const { path: relativePath, type } = req.body as { path: string; type: "file" | "dir" };
    const target = resolveWritePathInDir(getRoomProjectDir(req.params.roomId), relativePath);
    if (!target) return res.status(400).json({ error: "invalid path" });
    if (fs.existsSync(target)) return res.status(409).json({ error: "already exists" });
    if (type === "dir") fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
    }
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/rooms/:roomId/project/files",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const target = resolveWritePathInDir(getRoomProjectDir(req.params.roomId), String(req.query.path ?? ""));
    if (!target || !fs.existsSync(target)) return res.status(404).json({ error: "not found" });
    fs.rmSync(target, { recursive: true, force: true });
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.patch(
  "/api/rooms/:roomId/project/files",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const { from, to } = req.body as { from: string; to: string };
    const dir = getRoomProjectDir(req.params.roomId);
    const fromPath = resolveWritePathInDir(dir, from);
    const toPath = resolveWritePathInDir(dir, to);
    if (!fromPath || !toPath || !fs.existsSync(fromPath)) return res.status(400).json({ error: "invalid path" });
    if (fs.existsSync(toPath)) return res.status(409).json({ error: "already exists" });
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.renameSync(fromPath, toPath);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// Raw body (any file type) with the destination as ?path= — no multipart
// parsing needed for one file per request.
app.put(
  "/api/rooms/:roomId/project/upload",
  express.raw({ type: () => true, limit: "50mb" }),
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const relativePath = String(req.query.path ?? "");
    const target = resolveWritePathInDir(getRoomProjectDir(req.params.roomId), relativePath);
    if (!target || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "invalid upload" });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, req.body);
    bus.emit("sync");
    res.json({ path: relativePath });
  })
);

// --- room preview (run the shared project as a real site) ---
app.get(
  "/api/rooms/:roomId/preview/status",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    res.json(getPreviewState(req.params.roomId));
  })
);
app.post(
  "/api/rooms/:roomId/preview/start",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    // Static rooms need no gate (nothing executes) — only a real dev server
    // (npm install + npm run dev, arbitrary code execution) does, same bar
    // as Bash access.
    if (getPreviewState(req.params.roomId).mode === "node" && !TOOL_ACCESS_ENABLED) {
      return res.status(403).json({ error: "The server operator hasn't enabled running live dev servers." });
    }
    res.json(startPreview(req.params.roomId));
  })
);
app.post(
  "/api/rooms/:roomId/preview/stop",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    res.json(stopPreview(req.params.roomId));
  })
);

// --- rooms ---
app.post(
  "/api/rooms",
  handle((req, res) => {
    const { name, emoji } = req.body;
    const room = repo.createRoom(name, emoji, req.memberId);
    bus.emit("sync");
    res.json(room);
  })
);
app.post(
  "/api/rooms/:roomId/members",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    repo.addMemberToRoom(req.params.roomId, req.body.memberId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/rooms/:roomId/members/:memberId",
  handle((req, res) => {
    if (repo.getMemberRole(req.memberId) !== "owner") {
      return res.status(403).json({ error: "Only the workspace owner can remove members from a room." });
    }
    repo.removeMemberFromRoom(req.params.roomId, req.params.memberId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/rooms/:roomId/agents",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    repo.addAgentToRoom(req.body.agentId, req.params.roomId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/rooms/:roomId/agents/:agentId",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    repo.removeAgentFromRoom(req.params.agentId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/rooms/:roomId/agent-teams",
  handle((req, res) => {
    if (!requireRoomMember(req, res, req.params.roomId)) return;
    const agents = repo.addTeamToRoom(req.body.teamId, req.params.roomId);
    bus.emit("sync");
    res.json(agents);
  })
);

// --- task rooms ---
app.post(
  "/api/task-rooms",
  handle((req, res) => {
    const { roomId, name, emoji } = req.body;
    if (!requireRoomMember(req, res, roomId)) return;
    const taskRoom = repo.createTaskRoom(roomId, name, emoji, req.memberId);
    bus.emit("sync");
    res.json(taskRoom);
  })
);
app.patch(
  "/api/task-rooms/:id",
  handle((req, res) => {
    if (!requireTaskRoomMember(req, res, req.params.id)) return;
    repo.setTaskRoomStatus(req.params.id, req.body.status);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- messages (task room chat) ---
app.post(
  "/api/task-rooms/:id/messages",
  handle((req, res) => {
    const taskRoomId = req.params.id;
    if (!requireTaskRoomMember(req, res, taskRoomId)) return;
    const content = String(req.body.content ?? "");
    // Attachments are files already uploaded into the Room's project folder
    // (see the upload route) — only accept paths that really are in there.
    const taskRoom = repo.getTaskRoom(taskRoomId);
    if (!taskRoom) return res.status(404).json({ error: "task room not found" });
    if (req.body.attachments !== undefined && !Array.isArray(req.body.attachments)) {
      return res.status(400).json({ error: "attachments must be an array" });
    }
    const projectDir = getRoomProjectDir(taskRoom.roomId);
    const attachments = ((req.body.attachments ?? []) as unknown[]).map(String);
    if (attachments.some((p) => !resolveFileInDir(projectDir, p))) {
      return res.status(400).json({ error: "attachment not found in the project folder" });
    }
    if (!content.trim() && attachments.length === 0) return res.status(400).json({ error: "message is empty" });
    // Only agents the sender can see — a mention can't wake an agent from a
    // room they aren't in.
    const mentioned = findMentionedAgents(content).filter((a) => repo.canSeeAgent(req.memberId, a));

    const message = repo.addMessage(
      taskRoomId,
      "member",
      req.memberId,
      content,
      mentioned.map((a) => a.id),
      attachments
    );
    bus.emit("sync");
    res.json(message);

    for (const agent of mentioned) {
      runAgentTurn(agent.id, { kind: "task_room", taskRoomId, originMemberId: req.memberId }).catch((err) =>
        console.error("agent turn failed", err)
      );
    }
  })
);
app.patch(
  "/api/messages/:messageId",
  handle((req, res) => {
    const message = repo.getMessage(req.params.messageId);
    if (!message) return res.status(404).json({ error: "message not found" });
    if (!requireTaskRoomMember(req, res, message.taskRoomId)) return;
    if (message.authorType !== "member" || message.authorId !== req.memberId) {
      return res.status(403).json({ error: "You can only edit your own messages." });
    }
    repo.updateMessage(req.params.messageId, req.body.content);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/messages/:messageId",
  handle((req, res) => {
    const message = repo.getMessage(req.params.messageId);
    if (!message) return res.status(404).json({ error: "message not found" });
    if (!requireTaskRoomMember(req, res, message.taskRoomId)) return;
    if (message.authorType === "member" && message.authorId !== req.memberId) {
      return res.status(403).json({ error: "You can only delete your own messages." });
    }
    repo.deleteMessage(req.params.messageId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- direct messages ---
app.post(
  "/api/agents/:agentId/dm",
  handle((req, res) => {
    const agentId = req.params.agentId;
    const agent = repo.getAgent(agentId);
    // 404 (not 403) for an agent you can't see — same as it not existing for you.
    if (!agent || !repo.canSeeAgent(req.memberId, agent)) return res.status(404).json({ error: "agent not found" });
    const message = repo.addDirectMessage(agentId, "member", req.body.content, req.memberId);
    bus.emit("sync");
    res.json(message);
    runAgentTurn(agentId, { kind: "dm", agentId }).catch((err) => console.error("agent turn failed", err));
  })
);
app.patch(
  "/api/direct-messages/:dmId",
  handle((req, res) => {
    const dm = repo.getDirectMessage(req.params.dmId);
    if (!dm) return res.status(404).json({ error: "message not found" });
    if (dm.authorType !== "member" || dm.authorId !== req.memberId) {
      return res.status(403).json({ error: "You can only edit your own messages." });
    }
    repo.updateDirectMessage(req.params.dmId, req.body.content);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/direct-messages/:dmId",
  handle((req, res) => {
    const dm = repo.getDirectMessage(req.params.dmId);
    if (!dm) return res.status(404).json({ error: "message not found" });
    if (dm.authorType === "member" && dm.authorId !== req.memberId) {
      return res.status(403).json({ error: "You can only delete your own messages." });
    }
    repo.deleteDirectMessage(req.params.dmId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- agents ---
app.post(
  "/api/agents",
  handle((req, res) => {
    if (!requireTaskRoomMember(req, res, req.body.taskRoomId)) return;
    const agent = repo.createAgent({ ...req.body, createdById: req.memberId });
    bus.emit("sync");
    res.json(agent);
  })
);
app.patch(
  "/api/agents/:agentId/tools/:toolId",
  handle((req, res) => {
    const agent = requireAgentAccess(req, res);
    if (!agent) return;
    repo.toggleAgentTool(req.params.agentId, req.params.toolId, req.memberId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.patch(
  "/api/agents/:agentId/config",
  handle((req, res) => {
    const agent = requireAgentAccess(req, res);
    if (!agent) return;
    repo.updateAgentConfig(req.params.agentId, req.body);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/agents/:agentId",
  handle(async (req, res) => {
    const agent = requireAgentAccess(req, res);
    if (!agent) return;
    stopAgentTurn(agent.id);
    repo.removeAgent(req.params.agentId);
    await closeAgentSession(req.params.agentId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/agents/:agentId/run",
  handle((req, res) => {
    const agent = requireAgentAccess(req, res);
    if (!agent) return;
    res.json({ ok: true });
    runAgentTurn(agent.id, { kind: "task_room", taskRoomId: agent.taskRoomId, originMemberId: req.memberId }).catch((err) =>
      console.error("agent turn failed", err)
    );
  })
);
app.post(
  "/api/agents/:agentId/stop",
  handle((req, res) => {
    const agent = requireAgentAccess(req, res);
    if (!agent) return;
    stopAgentTurn(agent.id);
    repo.setAgentStatus(agent.id, "idle");
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/agents/stop-all",
  handle((req, res) => {
    // Same scope as the single-agent stop route above.
    for (const agent of repo.getAllAgents().filter((a) => repo.isTaskRoomMember(a.taskRoomId, req.memberId))) {
      stopAgentTurn(agent.id);
      if (agent.status === "running") repo.setAgentStatus(agent.id, "idle");
    }
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- agent teams ---
app.post(
  "/api/agent-teams",
  handle((req, res) => {
    const { name, agentIds, mode } = req.body;
    const team = repo.createAgentTeam(name, agentIds, mode, req.memberId);
    bus.emit("sync");
    res.json(team);
  })
);
app.delete(
  "/api/agent-teams/:teamId",
  handle((req, res) => {
    const team = repo.getAgentTeam(req.params.teamId);
    if (!team) return res.status(404).json({ error: "team not found" });
    if (team.createdById !== req.memberId && repo.getMemberRole(req.memberId) !== "owner") {
      return res.status(403).json({ error: "Only the team's creator or the workspace owner can delete it." });
    }
    repo.removeAgentTeam(req.params.teamId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/agent-teams/:teamId/add-to-room",
  handle((req, res) => {
    if (!requireTaskRoomMember(req, res, req.body.taskRoomId)) return;
    const clones = repo.addTeamToTaskRoom(req.params.teamId, req.body.taskRoomId, req.memberId);
    bus.emit("sync");
    res.json(clones);
  })
);

// --- workflows ---
app.post(
  "/api/workflows",
  handle((req, res) => {
    const { taskRoomId, name, description } = req.body;
    if (!requireTaskRoomMember(req, res, taskRoomId)) return;
    const workflow = repo.createWorkflow(taskRoomId, name, description ?? "");
    bus.emit("sync");
    res.json(workflow);
  })
);
app.post(
  "/api/workflows/:id/steps",
  handle((req, res) => {
    const workflow = repo.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ error: "workflow not found" });
    if (!requireTaskRoomMember(req, res, workflow.taskRoomId)) return;
    repo.addWorkflowStep(req.params.id, req.body.name);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.patch(
  "/api/workflows/:id/steps/:stepId",
  handle((req, res) => {
    const workflow = repo.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ error: "workflow not found" });
    if (!requireTaskRoomMember(req, res, workflow.taskRoomId)) return;
    repo.toggleWorkflowStep(req.params.id, req.params.stepId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/workflows/:id/complete",
  handle((req, res) => {
    const workflow = repo.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ error: "workflow not found" });
    if (!requireTaskRoomMember(req, res, workflow.taskRoomId)) return;
    repo.markWorkflowDone(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/workflows/:id",
  handle((req, res) => {
    const workflow = repo.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ error: "workflow not found" });
    if (!requireTaskRoomMember(req, res, workflow.taskRoomId)) return;
    repo.removeWorkflow(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- loops ---
app.post(
  "/api/loops",
  handle((req, res) => {
    const { taskRoomId, name, schedule } = req.body;
    if (!requireTaskRoomMember(req, res, taskRoomId)) return;
    const loop = repo.createLoop(taskRoomId, name, schedule);
    bus.emit("sync");
    res.json(loop);
  })
);
app.patch(
  "/api/loops/:id/toggle",
  handle((req, res) => {
    const loop = repo.getLoop(req.params.id);
    if (!loop) return res.status(404).json({ error: "loop not found" });
    if (!requireTaskRoomMember(req, res, loop.taskRoomId)) return;
    repo.toggleLoopActive(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/loops/:id",
  handle((req, res) => {
    const loop = repo.getLoop(req.params.id);
    if (!loop) return res.status(404).json({ error: "loop not found" });
    if (!requireTaskRoomMember(req, res, loop.taskRoomId)) return;
    repo.removeLoop(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- todos ---
app.post(
  "/api/todos",
  handle((req, res) => {
    const { taskRoomId, text, assigneeId, dueDate } = req.body;
    if (!requireTaskRoomMember(req, res, taskRoomId)) return;
    const todo = repo.addTodo(taskRoomId, text, assigneeId ?? null, dueDate ?? null);
    bus.emit("sync");
    res.json(todo);
  })
);
app.patch(
  "/api/todos/:id/toggle",
  handle((req, res) => {
    const todo = repo.getTodo(req.params.id);
    if (!todo) return res.status(404).json({ error: "todo not found" });
    if (!requireTaskRoomMember(req, res, todo.taskRoomId)) return;
    repo.toggleTodo(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- agent defaults / behavior settings / runtimes ---
app.put(
  "/api/agent-defaults",
  handle((req, res) => {
    if (!requireOwner(req, res)) return;
    repo.setAgentDefaults(req.body);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.patch(
  "/api/agent-behavior-settings",
  handle((req, res) => {
    if (!requireOwner(req, res)) return;
    const { key, value } = req.body;
    repo.setAgentBehaviorSetting(key, value);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
const RUNTIME_CLI_BINARY: Record<string, string> = { "runtime-goose": "goose" };
app.post(
  "/api/agent-runtimes/:id/install",
  handle(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const binary = RUNTIME_CLI_BINARY[req.params.id];
    if (binary && !(await isCliAvailable(binary))) {
      return res
        .status(400)
        .json({ error: `${binary} isn't installed on this machine yet. Install it, then try again.` });
    }
    repo.installRuntime(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- Claude Code's own auth (separate from Hivemark's stored Anthropic key) ---
app.get(
  "/api/runtimes/claude-code/status",
  handle(async (_req, res) => {
    res.json(await getClaudeCodeAuthStatus());
  })
);
app.post(
  "/api/runtimes/claude-code/login",
  handle((req, res) => {
    if (!requireOwner(req, res)) return;
    triggerClaudeCodeLogin();
    res.json({ ok: true });
  })
);

// --- connections (credentials) ---
const VALID_KEYS: ConnectionKey[] = ["anthropic", "openrouter", "github", "postgres", "slack", "linear"];
app.put(
  "/api/connections/:key",
  handle((req, res) => {
    if (!requireOwner(req, res)) return;
    const key = req.params.key as ConnectionKey;
    if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: "unknown connection key" });
    const value = String(req.body.value ?? "").trim();
    if (!value) return res.status(400).json({ error: "value required" });
    // API keys/tokens/connection strings are always printable ASCII — reject anything
    // else now with a clear message instead of letting it crash later as a cryptic
    // "Cannot convert argument to a ByteString" when used as an HTTP header value.
    if (!/^[\x20-\x7e]+$/.test(value)) {
      return res.status(400).json({ error: "That doesn't look like a valid key/token — it contains non-ASCII characters (e.g. emoji or line breaks). Check what you pasted." });
    }
    repo.setConnection(key, value);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/connections/:key",
  handle((req, res) => {
    if (!requireOwner(req, res)) return;
    const key = req.params.key as ConnectionKey;
    if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: "unknown connection key" });
    repo.removeConnection(key);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

const httpServer = createServer(app);
const wss = new WebSocketServer({
  server: httpServer,
  path: "/ws",
  verifyClient: ((info) => requireAuthForWebSocket(info.req.url)) satisfies VerifyClientCallbackSync,
});

bus.on("sync", () => {
  const payload = JSON.stringify({ type: "sync" });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Hivemark server listening on http://${HOST}:${PORT}${AUTH_ENABLED ? " (auth enabled)" : ""}`);
  startScheduler();
  startIdleSessionSweep();
});

// Cached MCP sessions spawn real child processes (npx servers, headless
// Chromium, etc.) — clean them up on a graceful shutdown so they don't
// linger as orphans once this process exits.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopAllPreviews();
    closeAllAgentSessions().finally(() => process.exit(0));
  });
}
