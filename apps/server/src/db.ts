import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { decryptSecret, encryptSecret, isEncrypted } from "./crypto.js";
import { AUTH_ENABLED } from "./authConfig.js";
import { randomBytes } from "node:crypto";
import type {
  Agent,
  AgentBehaviorSettings,
  AgentDefaults,
  AgentGrant,
  AgentRuntime,
  AgentTeam,
  AgentTeamMode,
  AppState,
  ChatMessage,
  ConnectionKey,
  ConnectionStatus,
  DirectMessage,
  Loop,
  LoopRun,
  McpTool,
  Member,
  Room,
  TaskRoom,
  TaskRoomStatus,
  TodoItem,
  Workflow,
  WorkflowStep,
} from "./types.js";

// HIVEMARK_DATA_DIR: the packaged desktop app points this at the OS app-data
// folder — next to dist/ would be inside the app bundle, wiped on every update.
const DATA_DIR = process.env.HIVEMARK_DATA_DIR ?? path.join(import.meta.dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(path.join(DATA_DIR, "hivemark.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  member_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS task_rooms (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  status TEXT NOT NULL,
  member_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  task_room_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mentioned_agent_ids TEXT NOT NULL DEFAULT '[]',
  edited_at TEXT
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  task_room_id TEXT NOT NULL,
  room_id TEXT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar_emoji TEXT NOT NULL,
  model TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle',
  created_by_id TEXT NOT NULL,
  grants TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS agent_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  agent_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS agent_runtimes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL,
  install_hint TEXT,
  setup_url TEXT
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  task_room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  steps TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS loops (
  id TEXT PRIMARY KEY,
  task_room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_run TEXT,
  next_run TEXT
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  task_room_id TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  assignee_id TEXT,
  due_date TEXT
);

CREATE TABLE IF NOT EXISTS agent_defaults (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  model TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS agent_behavior_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  keep_addressed_agents_active INTEGER NOT NULL DEFAULT 0,
  keep_awake_while_agents_active INTEGER NOT NULL DEFAULT 0
);

-- Credentials. Values are encrypted at rest (see crypto.ts) with a key kept
-- in a separate 0600 file next to this database. Never expose this table's
-- contents over the API.
CREATE TABLE IF NOT EXISTS connections (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Every one of these backs a WHERE clause that's run either per-request
-- (getMessagesForTaskRoom/getDirectMessagesForAgent, called on every agent
-- turn) or inside getState() (messages/direct_messages ORDER BY created_at
-- with no WHERE — the index still lets SQLite walk it pre-sorted instead of
-- building a temp b-tree). better-sqlite3 is synchronous, so an unindexed
-- scan here blocks the whole Node event loop for every connected client,
-- not just the requester.
CREATE INDEX IF NOT EXISTS idx_messages_task_room ON messages(task_room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_direct_messages_agent ON direct_messages(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_direct_messages_created_at ON direct_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_task_rooms_room ON task_rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_workflows_task_room ON workflows(task_room_id);
CREATE INDEX IF NOT EXISTS idx_loops_task_room ON loops(task_room_id);
CREATE INDEX IF NOT EXISTS idx_todos_task_room ON todos(task_room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);
`);

// Migration for DBs created before `agents.room_id` existed — CREATE TABLE IF
// NOT EXISTS above only applies to a fresh install, so existing tables need an
// explicit ALTER. Safe to run every boot: guarded on the column already existing.
{
  const agentCols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  if (!agentCols.some((c) => c.name === "room_id")) {
    db.exec("ALTER TABLE agents ADD COLUMN room_id TEXT");
  }
  // Not in the schema block above — on a pre-room_id DB it would fail there,
  // before this ALTER ever ran, crashing every boot.
  db.exec("CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(room_id)");
}

// Codex doesn't actually need a separate install step (it's fetched on demand via
// npx) — correct any DB seeded before this was realized, where it was marked
// "cli_needed" and required a click through a non-functional "Install" button.
db.prepare("UPDATE agent_runtimes SET status = 'ready' WHERE id = 'runtime-codex' AND status = 'cli_needed'").run();
// Make the subscription option discoverable — the old text didn't say it.
const CLAUDE_CODE_DESC = "Runs on your Claude Pro/Max subscription (or the API key) of the Claude Code CLI signed in on this machine — no Hivemark API key needed.";
db.prepare("UPDATE agent_runtimes SET description = ? WHERE id = 'runtime-claude-code'").run(CLAUDE_CODE_DESC);

// Files / Preview MCP tools — added after mcp_tools could already be seeded,
// so a fresh seedCatalog() run won't fire on existing DBs. UPDATE covers a
// description change after a row already existed on a live DB (e.g.
// mcp-filesystem's description changed when its shared folder became
// Room-scoped instead of one global bucket).
const FILESYSTEM_DESC = "Create files in a private workspace, or the Room's shared project folder";
db.prepare("INSERT OR IGNORE INTO mcp_tools (id, name, description, icon) VALUES ('mcp-filesystem', 'Files', ?, 'folder')").run(
  FILESYSTEM_DESC
);
db.prepare("UPDATE mcp_tools SET description = ? WHERE id = 'mcp-filesystem'").run(FILESYSTEM_DESC);

db.prepare("INSERT OR IGNORE INTO mcp_tools (id, name, description, icon) VALUES ('mcp-preview', 'Preview', ?, 'globe')").run(
  "Start/stop a live preview of the Room's project (npm run dev) so it can be checked in the app"
);

// Loop run history — added after loops could already exist, so a fresh CREATE
// TABLE IF NOT EXISTS won't run against an existing DB file. This table itself
// is new, so no ALTER is needed, just the guarded create below.
db.exec(`
CREATE TABLE IF NOT EXISTS loop_runs (
  id TEXT PRIMARY KEY,
  loop_id TEXT NOT NULL,
  ran_at TEXT NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loop_runs_loop ON loop_runs(loop_id, ran_at);
`);

// Message editing — added after messages could already exist.
for (const table of ["messages", "direct_messages"]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "edited_at")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN edited_at TEXT`);
  }
}

// Team creator — added after agent_teams could already exist.
{
  const cols = db.prepare("PRAGMA table_info(agent_teams)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "created_by_id")) db.exec("ALTER TABLE agent_teams ADD COLUMN created_by_id TEXT");
}

// Chat attachments (files in the Room's project folder) — added after
// messages could already exist.
{
  const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "attachments")) {
    db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
  }
}

// Built-in (not MCP) capability — Anthropic's server-side web search/fetch,
// see claudeAgent.ts. Lives in the same catalog so it's granted the same way.
db.prepare("INSERT OR IGNORE INTO mcp_tools (id, name, description, icon) VALUES ('web-research', 'Web research', ?, 'globe')").run(
  "Search the web and read pages (Hivemark Agent runtime)"
);

// Credential encryption — added after connections could already hold plaintext
// values. Encrypts any row not already in our encrypted format in place.
{
  const rows = db.prepare("SELECT key, value FROM connections").all() as { key: string; value: string | null }[];
  const reEncrypt = db.prepare("UPDATE connections SET value = ? WHERE key = ?");
  for (const row of rows) {
    if (row.value && !isEncrypted(row.value)) {
      reEncrypt.run(encryptSecret(DATA_DIR, row.value), row.key);
    }
  }
}

// Real member auth — added after members/direct_messages could already exist.
{
  const memberCols = db.prepare("PRAGMA table_info(members)").all() as { name: string }[];
  if (!memberCols.some((c) => c.name === "email")) db.exec("ALTER TABLE members ADD COLUMN email TEXT");
  if (!memberCols.some((c) => c.name === "avatar_url")) db.exec("ALTER TABLE members ADD COLUMN avatar_url TEXT");
}
{
  const dmCols = db.prepare("PRAGMA table_info(direct_messages)").all() as { name: string }[];
  if (!dmCols.some((c) => c.name === "author_id")) {
    db.exec("ALTER TABLE direct_messages ADD COLUMN author_id TEXT");
  }
  // Private DMs: each row belongs to one member's thread (backfilled below,
  // after the demo seed).
  if (!dmCols.some((c) => c.name === "member_id")) {
    db.exec("ALTER TABLE direct_messages ADD COLUMN member_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_direct_messages_thread ON direct_messages(agent_id, member_id, created_at)");
  // /api/state loads the caller's DMs (WHERE member_id = ? ORDER BY created_at).
  db.exec("CREATE INDEX IF NOT EXISTS idx_direct_messages_member ON direct_messages(member_id, created_at)");
}

// Expired sessions are otherwise harmless (rejected at lookup) — a boot-time
// sweep is enough, no need for a running timer.
db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/** Identity used when auth is disabled (no OAuth provider configured) —
 * every request behaves exactly as it always has, as this single member. */
export const CURRENT_MEMBER_ID = "m-roman";

/** Catalog/config data the app needs to function — always seeded once,
 * regardless of whether real auth is enabled. Gated on agent_runtimes being
 * empty since, unlike the demo workspace data below, this has no dependency
 * on members existing. */
function seedCatalog() {
  const count = (db.prepare("SELECT COUNT(*) as c FROM agent_runtimes").get() as { c: number }).c;
  if (count > 0) return;

  // OR IGNORE: mcp-filesystem/mcp-preview are also seeded unconditionally
  // above (lines ~220-228) on every boot, before this runs — on a genuinely
  // fresh DB (agent_runtimes empty) a plain INSERT here would collide with
  // those and crash, permanently wedging a first-time install since
  // agent_runtimes would then stay empty forever (crash-looping on every
  // subsequent boot too).
  const insertTool = db.prepare("INSERT OR IGNORE INTO mcp_tools (id, name, description, icon) VALUES (?,?,?,?)");
  const mcpTools: McpTool[] = [
    { id: "mcp-github", name: "GitHub", description: "Read/write repos, PRs, issues", icon: "code" },
    { id: "mcp-linear", name: "Linear", description: "Create and update tickets", icon: "list" },
    { id: "mcp-postgres", name: "Postgres", description: "Query the staging database", icon: "database" },
    { id: "mcp-browser", name: "Browser", description: "Navigate and read web pages", icon: "globe" },
    { id: "mcp-slack", name: "Slack Export", description: "Read message history for context", icon: "message" },
    {
      id: "mcp-filesystem",
      name: "Files",
      description: "Create files in a private workspace, or the Room's shared project folder",
      icon: "folder",
    },
    {
      id: "mcp-preview",
      name: "Preview",
      description: "Start/stop a live preview of the Room's project (npm run dev) so it can be checked in the app",
      icon: "globe",
    },
  ];
  for (const t of mcpTools) insertTool.run(t.id, t.name, t.description, t.icon);

  const insertRuntime = db.prepare(
    "INSERT INTO agent_runtimes (id, name, icon, status, description, install_hint, setup_url) VALUES (?,?,?,?,?,?,?)"
  );
  insertRuntime.run("runtime-hivemark", "Hivemark Agent", "🐝", "ready", "Runs natively inside Hivemark. No install needed.", null, null);
  insertRuntime.run("runtime-claude-code", "Claude Code", "✳️", "ready", CLAUDE_CODE_DESC, null, null);
  insertRuntime.run("runtime-codex", "Codex", "⌨️", "ready", "Hivemark talks to the Codex CLI through an ACP adapter, fetched on demand via npx — no separate install needed. Needs Codex/OpenAI credentials configured on this machine.", null, "https://github.com/agentclientprotocol");
  insertRuntime.run("runtime-goose", "Goose", "🦢", "cli_needed", "Hivemark talks to Goose through the Goose CLI.", null, "https://block.github.io/goose/");
  insertRuntime.run("runtime-openrouter", "OpenRouter", "🌐", "ready", "Calls any model OpenRouter hosts (not just Claude) — type the model slug directly, e.g. openai/gpt-4o.", null, "https://openrouter.ai/keys");

  db.prepare("INSERT INTO agent_defaults (id, model, runtime_id, instructions) VALUES (1, ?, ?, '')").run(
    "", // empty = the provider's newest Sonnet (see web ModelInput / modelIds.ts)
    "runtime-hivemark"
  );
  db.prepare(
    "INSERT INTO agent_behavior_settings (id, keep_addressed_agents_active, keep_awake_while_agents_active) VALUES (1, 0, 0)"
  ).run();
}

/** Fictional demo members/rooms/chat history — only seeded when auth is
 * disabled (a real self-hosted deployment with real accounts shouldn't boot
 * with 4 fake people and pre-written conversations). */
function seedDemoWorkspace() {
  if (AUTH_ENABLED) return;
  const count = (db.prepare("SELECT COUNT(*) as c FROM members").get() as { c: number }).c;
  if (count > 0) return;

  const insertMember = db.prepare(
    "INSERT INTO members (id, name, initials, color, role) VALUES (?,?,?,?,?)"
  );
  const members: Member[] = [
    { id: "m-roman", name: "Roman Melchner", initials: "RM", color: "#5b5cff", role: "owner" },
    { id: "m-jana", name: "Jana Voigt", initials: "JV", color: "#00b389", role: "member" },
    { id: "m-tom", name: "Tom Reiber", initials: "TR", color: "#ffb020", role: "member" },
    { id: "m-lea", name: "Lea Sander", initials: "LS", color: "#ff6b6b", role: "member" },
  ];
  for (const m of members) insertMember.run(m.id, m.name, m.initials, m.color, m.role);

  const insertRoom = db.prepare(
    "INSERT INTO rooms (id, name, emoji, member_ids) VALUES (?,?,?,?)"
  );
  insertRoom.run("room-platform", "Platform Team", "🧩", JSON.stringify(["m-roman", "m-jana", "m-tom"]));
  insertRoom.run("room-launch", "Q3 Launch", "🚀", JSON.stringify(["m-roman", "m-lea", "m-jana"]));

  const insertTaskRoom = db.prepare(
    "INSERT INTO task_rooms (id, room_id, name, emoji, status, member_ids) VALUES (?,?,?,?,?,?)"
  );
  insertTaskRoom.run("tr-onboarding", "room-platform", "Rework onboarding flow", "🛬", "in_progress", JSON.stringify(["m-roman", "m-jana"]));
  insertTaskRoom.run("tr-billing", "room-platform", "Fix billing webhook retries", "💳", "open", JSON.stringify(["m-tom", "m-roman"]));
  insertTaskRoom.run("tr-landing", "room-launch", "New landing page", "🖼️", "in_progress", JSON.stringify(["m-lea", "m-roman"]));
  insertTaskRoom.run("tr-pricing", "room-launch", "Pricing page copy pass", "🏷️", "done", JSON.stringify(["m-jana", "m-lea"]));

  const insertMessage = db.prepare(
    "INSERT INTO messages (id, task_room_id, author_type, author_id, content, created_at, mentioned_agent_ids) VALUES (?,?,?,?,?,?,?)"
  );
  insertMessage.run("msg-1", "tr-onboarding", "member", "m-jana", "Drafted the new 3-step onboarding. Kicking off the agent to audit drop-off events.", "2026-07-29T09:12:00Z", "[]");
  insertMessage.run("msg-2", "tr-onboarding", "agent", "agent-onboarding-auditor", "Pulled the last 14 days of onboarding events via Postgres. Step 2 (workspace naming) has a 38% drop-off — highest of all steps.", "2026-07-29T09:15:00Z", "[]");
  insertMessage.run("msg-3", "tr-onboarding", "member", "m-roman", "Good catch. Let's default the workspace name instead of requiring input.", "2026-07-29T09:20:00Z", "[]");

  const insertDm = db.prepare(
    "INSERT INTO direct_messages (id, agent_id, author_type, content, created_at) VALUES (?,?,?,?,?)"
  );
  insertDm.run("dm-1", "agent-onboarding-auditor", "member", "Can you re-check the drop-off numbers for the last 7 days specifically?", "2026-07-29T16:40:00Z");
  insertDm.run("dm-2", "agent-onboarding-auditor", "agent", "On it — pulling the last 7 days from Postgres now. Step 2 is still the biggest drop-off point, at 34%.", "2026-07-29T16:41:00Z");

  const insertAgent = db.prepare(
    "INSERT INTO agents (id, task_room_id, name, color, avatar_emoji, model, runtime_id, instructions, status, created_by_id, grants) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  const grant = (toolId: string, memberId: string, at: string): AgentGrant[] => [
    { toolId, grantedById: memberId, grantedAt: at },
  ];
  insertAgent.run(
    "agent-onboarding-auditor", "tr-onboarding", "Onboarding Auditor", "#5b5cff", "🔎",
    "Claude Sonnet 5", "runtime-hivemark",
    "Analyze onboarding funnel drop-off using Postgres data and summarize findings in chat.",
    "idle", "m-jana", JSON.stringify(grant("mcp-postgres", "m-jana", "2026-07-28T18:00:00Z"))
  );
  insertAgent.run(
    "agent-webhook-medic", "tr-billing", "Webhook Medic", "#ff6b6b", "🩹",
    "Claude Opus 4.8", "runtime-claude-code",
    "Watch billing webhook retries and open a GitHub issue when the failure rate spikes.",
    "idle", "m-tom", JSON.stringify(grant("mcp-github", "m-tom", "2026-07-29T09:00:00Z"))
  );
  insertAgent.run(
    "agent-copy-writer", "tr-landing", "Copy Writer", "#00b389", "✍️",
    "Claude Sonnet 5", "runtime-hivemark",
    "Draft landing page copy variants for the Q3 launch hero section.",
    "idle", "m-lea", "[]"
  );

  const insertTeam = db.prepare("INSERT INTO agent_teams (id, name, mode, agent_ids) VALUES (?,?,?,?)");
  insertTeam.run(
    "team-launch-crew", "Launch Crew", "auto",
    JSON.stringify(["agent-onboarding-auditor", "agent-webhook-medic", "agent-copy-writer"])
  );

  const insertWorkflow = db.prepare(
    "INSERT INTO workflows (id, task_room_id, name, description, status, steps) VALUES (?,?,?,?,?,?)"
  );
  const steps: WorkflowStep[] = [
    { id: "s1", name: "Audit drop-off funnel", done: true },
    { id: "s2", name: "Design 3-step flow", done: true },
    { id: "s3", name: "Implement + default workspace name", done: false },
    { id: "s4", name: "Ship behind flag to 10%", done: false },
  ];
  insertWorkflow.run(
    "wf-onboarding-revamp", "tr-onboarding", "Ship onboarding revamp",
    "End-to-end rollout of the reworked onboarding flow.", "running", JSON.stringify(steps)
  );

  const insertLoop = db.prepare(
    "INSERT INTO loops (id, task_room_id, name, schedule, active, last_run, next_run) VALUES (?,?,?,?,?,?,?)"
  );
  insertLoop.run("loop-funnel-check", "tr-onboarding", "Daily funnel health check", "Every day at 08:00", 1, "2026-07-30T08:00:00Z", "2026-07-31T08:00:00Z");

  const insertTodo = db.prepare(
    "INSERT INTO todos (id, task_room_id, text, done, assignee_id, due_date) VALUES (?,?,?,?,?,?)"
  );
  insertTodo.run("td-1", "tr-onboarding", "Default workspace name field", 0, "m-roman", "2026-08-01");
  insertTodo.run("td-2", "tr-onboarding", "Update onboarding analytics events", 0, "m-jana", null);
  insertTodo.run("td-3", "tr-onboarding", "Write rollout announcement", 1, "m-jana", "2026-07-25");
  insertTodo.run("td-4", "tr-onboarding", "QA the redirect after signup", 0, null, "2026-08-05");
}

seedCatalog();
seedDemoWorkspace();

// Member DMs written before author_id existed (and the demo seed's) were all
// by the single pre-auth member — attribute them so the edit/delete
// "own messages only" check in index.ts doesn't lock everyone out of them.
db.prepare("UPDATE direct_messages SET author_id = ? WHERE author_type = 'member' AND author_id IS NULL").run(
  CURRENT_MEMBER_ID
);
// DMs from before they were private: a member's own messages are their
// thread; an agent reply belongs to whoever wrote the message it answered
// (the latest member message before it to that agent).
db.exec(`
UPDATE direct_messages SET member_id = author_id WHERE member_id IS NULL AND author_type = 'member';
UPDATE direct_messages SET member_id = (
  SELECT d2.author_id FROM direct_messages d2
  WHERE d2.agent_id = direct_messages.agent_id AND d2.author_type = 'member' AND d2.created_at <= direct_messages.created_at
  ORDER BY d2.created_at DESC LIMIT 1
) WHERE member_id IS NULL AND author_type = 'agent';
`);
db.prepare("UPDATE direct_messages SET member_id = ? WHERE member_id IS NULL").run(CURRENT_MEMBER_ID);
// The old seed pinned the default model; follow the provider's newest instead.
db.prepare("UPDATE agent_defaults SET model = '' WHERE model = 'Claude Sonnet 5'").run();

/** Who every request acts as when auth is disabled: the pre-auth local member
 * — or, for a workspace that was first set up with OAuth (so has no
 * "m-roman"), its owner; otherwise every route would 403 for a member that
 * doesn't exist. Fixed at boot: members can't change while auth is off. */
export const LOCAL_MEMBER_ID: string =
  (db.prepare("SELECT id FROM members WHERE id = ?").get(CURRENT_MEMBER_ID) as { id: string } | undefined)?.id ??
  (db.prepare("SELECT id FROM members WHERE role = 'owner' ORDER BY rowid LIMIT 1").get() as { id: string } | undefined)?.id ??
  CURRENT_MEMBER_ID;

// ---------------------------------------------------------------------------
// Row <-> domain-type mapping helpers
// ---------------------------------------------------------------------------

/** Every array-typed column is stored via JSON.stringify(arr), which always
 * writes the empty array as exactly "[]" — skip the JSON.parse call for that
 * (by far the most common value: most messages mention no agents, most
 * agents hold no grants) rather than paying a full parse for "nothing". */
function parseArray<T = unknown>(json: string): T[] {
  return json === "[]" ? [] : JSON.parse(json);
}

function rowToMember(r: any): Member {
  return {
    id: r.id,
    name: r.name,
    initials: r.initials,
    color: r.color,
    role: r.role,
    email: r.email ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
  };
}

function rowToRoom(r: any, taskRoomIdsByRoom?: Map<string, string[]>): Room {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    memberIds: parseArray(r.member_ids),
    taskRoomIds: taskRoomIdsByRoom
      ? (taskRoomIdsByRoom.get(r.id) ?? [])
      : (db.prepare("SELECT id FROM task_rooms WHERE room_id = ?").all(r.id) as any[]).map((t) => t.id),
  };
}

/** Batched alternative to mapping rowToRoom one-by-one (each of which would
 * otherwise run its own task_rooms query) — used by getState() where every
 * room is fetched at once anyway. */
function taskRoomIdsByRoom(): Map<string, string[]> {
  const rows = db.prepare("SELECT id, room_id FROM task_rooms").all() as { id: string; room_id: string }[];
  const byRoom = new Map<string, string[]>();
  for (const t of rows) {
    const list = byRoom.get(t.room_id);
    if (list) list.push(t.id);
    else byRoom.set(t.room_id, [t.id]);
  }
  return byRoom;
}

function rowToTaskRoom(r: any): TaskRoom {
  return {
    id: r.id,
    roomId: r.room_id,
    name: r.name,
    emoji: r.emoji,
    status: r.status as TaskRoomStatus,
    memberIds: parseArray(r.member_ids),
  };
}

function rowToMessage(r: any): ChatMessage {
  return {
    id: r.id,
    taskRoomId: r.task_room_id,
    authorType: r.author_type,
    authorId: r.author_id,
    content: r.content,
    createdAt: r.created_at,
    mentionedAgentIds: parseArray(r.mentioned_agent_ids),
    attachments: parseArray(r.attachments),
    editedAt: r.edited_at ?? null,
  };
}

function rowToDm(r: any): DirectMessage {
  return {
    id: r.id,
    agentId: r.agent_id,
    authorType: r.author_type,
    authorId: r.author_id ?? null,
    memberId: r.member_id ?? null,
    content: r.content,
    createdAt: r.created_at,
    editedAt: r.edited_at ?? null,
  };
}

function rowToAgent(r: any): Agent {
  return {
    id: r.id,
    taskRoomId: r.task_room_id,
    roomId: r.room_id ?? null,
    name: r.name,
    color: r.color,
    avatarEmoji: r.avatar_emoji,
    model: r.model,
    runtimeId: r.runtime_id,
    instructions: r.instructions,
    status: r.status,
    createdById: r.created_by_id,
    grants: parseArray(r.grants),
  };
}

function rowToTeam(r: any): AgentTeam {
  return {
    id: r.id,
    name: r.name,
    mode: r.mode as AgentTeamMode,
    agentIds: parseArray(r.agent_ids),
    createdById: r.created_by_id ?? null,
  };
}

function rowToRuntime(r: any): AgentRuntime {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    status: r.status,
    description: r.description,
    installHint: r.install_hint ?? undefined,
    setupUrl: r.setup_url ?? undefined,
  };
}

function rowToWorkflow(r: any): Workflow {
  return {
    id: r.id,
    taskRoomId: r.task_room_id,
    name: r.name,
    description: r.description,
    status: r.status,
    steps: parseArray(r.steps),
  };
}

function getLoopRuns(loopId: string): LoopRun[] {
  return (
    db
      .prepare("SELECT ran_at, outcome FROM loop_runs WHERE loop_id = ? ORDER BY ran_at DESC LIMIT 5")
      .all(loopId) as any[]
  ).map((r) => ({ timestamp: r.ran_at, outcome: r.outcome }));
}

function rowToLoop(r: any, runsByLoop?: Map<string, LoopRun[]>): Loop {
  return {
    id: r.id,
    taskRoomId: r.task_room_id,
    name: r.name,
    schedule: r.schedule,
    active: !!r.active,
    lastRun: r.last_run,
    nextRun: r.next_run,
    runs: runsByLoop ? (runsByLoop.get(r.id) ?? []) : getLoopRuns(r.id),
  };
}

/** Batched alternative to getLoopRuns per-row — used by getState() where
 * every loop is fetched at once anyway (including every scheduler tick). */
function allLoopRuns(): Map<string, LoopRun[]> {
  const rows = db
    .prepare("SELECT loop_id, ran_at, outcome FROM loop_runs ORDER BY ran_at DESC")
    .all() as { loop_id: string; ran_at: string; outcome: string }[];
  const byLoop = new Map<string, LoopRun[]>();
  for (const r of rows) {
    let list = byLoop.get(r.loop_id);
    if (!list) {
      list = [];
      byLoop.set(r.loop_id, list);
    }
    if (list.length < 5) list.push({ timestamp: r.ran_at, outcome: r.outcome });
  }
  return byLoop;
}

function rowToTodo(r: any): TodoItem {
  return {
    id: r.id,
    taskRoomId: r.task_room_id,
    text: r.text,
    done: !!r.done,
    assigneeId: r.assignee_id,
    dueDate: r.due_date,
  };
}

const CONNECTION_LABELS: Record<ConnectionKey, string> = {
  anthropic: "Anthropic API key",
  openrouter: "OpenRouter API key",
  github: "GitHub personal access token",
  postgres: "Postgres connection string",
  slack: "Slack bot token",
  linear: "Linear API key",
};

function connectionStatus(key: ConnectionKey): ConnectionStatus {
  const row = db.prepare("SELECT value FROM connections WHERE key = ?").get(key) as
    | { value: string | null }
    | undefined;
  const value = row?.value ? decryptSecret(DATA_DIR, row.value) : null;
  return {
    key,
    label: CONNECTION_LABELS[key],
    connected: !!value,
    hint: value ? value.slice(-4) : null,
  };
}

// db.prepare(sql) recompiles the SQL from scratch every call (~8x slower
// than reusing the returned Statement, measured locally: ~8.1us vs ~0.9us
// per call) — better-sqlite3 does no caching of its own. Not worth doing for
// every one of this file's call sites (most run once per request, where the
// difference is noise), but these back the queries on the hottest paths:
// every single agent turn (message/DM history, agent/member lookups) and
// every scheduler tick (active loops) — cache just those.
const stmtMessagesForTaskRoom = db.prepare("SELECT * FROM messages WHERE task_room_id = ? ORDER BY created_at ASC");
const stmtDirectMessagesForAgent = db.prepare(
  "SELECT * FROM direct_messages WHERE agent_id = ? AND member_id = ? ORDER BY created_at ASC"
);
const stmtAllAgents = db.prepare("SELECT * FROM agents");
const stmtAllMembers = db.prepare("SELECT * FROM members");
const stmtActiveLoops = db.prepare("SELECT * FROM loops WHERE active = 1");

// ---------------------------------------------------------------------------
// Repository — the only interface routes/services should use to touch the DB
// ---------------------------------------------------------------------------

export const repo = {
  /** Everything, except DMs: only `dmMemberId`'s own threads (DMs are
   * private — loading every member's just to filter them out was wasted).
   * withMessages=false skips the biggest table for a caller that loads only
   * the task rooms it can see (getScopedState). */
  getState(dmMemberId: string, withMessages = true): AppState {
    return {
      members: (db.prepare("SELECT * FROM members").all() as any[]).map(rowToMember),
      mcpTools: (db.prepare("SELECT * FROM mcp_tools").all() as any[]).map(
        (r): McpTool => ({ id: r.id, name: r.name, description: r.description, icon: r.icon })
      ),
      rooms: (() => {
        const byRoom = taskRoomIdsByRoom();
        return (db.prepare("SELECT * FROM rooms").all() as any[]).map((r) => rowToRoom(r, byRoom));
      })(),
      taskRooms: (db.prepare("SELECT * FROM task_rooms").all() as any[]).map(rowToTaskRoom),
      messages: withMessages
        ? (db.prepare("SELECT * FROM messages ORDER BY created_at ASC").all() as any[]).map(rowToMessage)
        : [],
      directMessages: (
        db.prepare("SELECT * FROM direct_messages WHERE member_id = ? ORDER BY created_at ASC").all(dmMemberId) as any[]
      ).map(rowToDm),
      agents: (db.prepare("SELECT * FROM agents").all() as any[]).map(rowToAgent),
      agentTeams: (db.prepare("SELECT * FROM agent_teams").all() as any[]).map(rowToTeam),
      agentRuntimes: (db.prepare("SELECT * FROM agent_runtimes").all() as any[]).map(rowToRuntime),
      agentBehaviorSettings: (() => {
        const r = db.prepare("SELECT * FROM agent_behavior_settings WHERE id = 1").get() as any;
        return {
          keepAddressedAgentsActive: !!r.keep_addressed_agents_active,
          keepAwakeWhileAgentsActive: !!r.keep_awake_while_agents_active,
        } satisfies AgentBehaviorSettings;
      })(),
      agentDefaults: (() => {
        const r = db.prepare("SELECT * FROM agent_defaults WHERE id = 1").get() as any;
        return { model: r.model, runtimeId: r.runtime_id, instructions: r.instructions } satisfies AgentDefaults;
      })(),
      workflows: (db.prepare("SELECT * FROM workflows").all() as any[]).map(rowToWorkflow),
      loops: (() => {
        const runsByLoop = allLoopRuns();
        return (db.prepare("SELECT * FROM loops").all() as any[]).map((r) => rowToLoop(r, runsByLoop));
      })(),
      todos: (db.prepare("SELECT * FROM todos").all() as any[]).map(rowToTodo),
      connections: (["anthropic", "openrouter", "github", "postgres", "slack", "linear"] as ConnectionKey[]).map(
        connectionStatus
      ),
    };
  },

  /** The public /api/state response for a given caller — the owner sees
   * everything (unscoped), any other member only sees rooms/task rooms
   * they're actually listed on and everything derived from those (messages,
   * agents, workflows, loops, todos). members/mcpTools/agentTeams/runtimes/
   * defaults/behaviorSettings/connections stay unscoped. DMs are private to
   * their member for everyone, the owner included.
   * Visibility is computed in memory from the rooms/task rooms loaded here —
   * the same rule as isTaskRoomMember/canSeeAgent, minus their per-agent and
   * per-DM queries (thousands per request for a non-owner). */
  getScopedState(callerId: string): AppState {
    if (repo.getMemberRole(callerId) === "owner") return repo.getState(callerId);
    const full = repo.getState(callerId, false);

    const visibleRoomIds = new Set(full.rooms.filter((r) => r.memberIds.includes(callerId)).map((r) => r.id));
    const visibleTaskRoomIds = new Set(
      full.taskRooms
        .filter((t) => visibleRoomIds.has(t.roomId) && t.memberIds.includes(callerId))
        .map((t) => t.id)
    );
    // Only agents this member can see (and so @mention or DM) — canSeeAgent's rule.
    const agents = full.agents.filter(
      (a) => visibleTaskRoomIds.has(a.taskRoomId) || (!!a.roomId && visibleRoomIds.has(a.roomId))
    );
    const visibleAgentIds = new Set(agents.map((a) => a.id));

    return {
      ...full,
      rooms: full.rooms
        .filter((r) => visibleRoomIds.has(r.id))
        .map((r) => ({ ...r, taskRoomIds: r.taskRoomIds.filter((id) => visibleTaskRoomIds.has(id)) })),
      taskRooms: full.taskRooms.filter((t) => visibleTaskRoomIds.has(t.id)),
      messages: (
        db
          .prepare(
            "SELECT * FROM messages WHERE task_room_id IN (SELECT value FROM json_each(?)) ORDER BY created_at ASC"
          )
          .all(JSON.stringify([...visibleTaskRoomIds])) as any[]
      ).map(rowToMessage),
      agents,
      directMessages: full.directMessages.filter((dm) => visibleAgentIds.has(dm.agentId)),
      workflows: full.workflows.filter((w) => visibleTaskRoomIds.has(w.taskRoomId)),
      loops: full.loops.filter((l) => visibleTaskRoomIds.has(l.taskRoomId)),
      todos: full.todos.filter((t) => visibleTaskRoomIds.has(t.taskRoomId)),
    };
  },

  // --- rooms ---
  createRoom(name: string, emoji: string, memberId: string): Room {
    const roomId = id("room");
    db.prepare("INSERT INTO rooms (id, name, emoji, member_ids) VALUES (?,?,?,?)").run(
      roomId,
      name,
      emoji,
      JSON.stringify([memberId])
    );
    return rowToRoom(db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId));
  },

  getRoom(roomId: string): Room | null {
    const r = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
    return r ? rowToRoom(r) : null;
  },

  addMemberToRoom(roomId: string, memberId: string) {
    const row = db.prepare("SELECT member_ids FROM rooms WHERE id = ?").get(roomId) as
      | { member_ids: string }
      | undefined;
    if (!row) return;
    const ids: string[] = JSON.parse(row.member_ids);
    if (!ids.includes(memberId)) ids.push(memberId);
    db.prepare("UPDATE rooms SET member_ids = ? WHERE id = ?").run(JSON.stringify(ids), roomId);
  },

  removeMemberFromRoom(roomId: string, memberId: string) {
    const row = db.prepare("SELECT member_ids FROM rooms WHERE id = ?").get(roomId) as
      | { member_ids: string }
      | undefined;
    if (!row) return;
    const ids: string[] = JSON.parse(row.member_ids).filter((m: string) => m !== memberId);
    db.prepare("UPDATE rooms SET member_ids = ? WHERE id = ?").run(JSON.stringify(ids), roomId);
  },

  getMemberRole(memberId: string): "owner" | "member" | null {
    const row = db.prepare("SELECT role FROM members WHERE id = ?").get(memberId) as
      | { role: "owner" | "member" }
      | undefined;
    return row?.role ?? null;
  },

  // --- task rooms ---
  createTaskRoom(roomId: string, name: string, emoji: string, memberId: string): TaskRoom {
    const taskRoomId = id("tr");
    db.prepare(
      "INSERT INTO task_rooms (id, room_id, name, emoji, status, member_ids) VALUES (?,?,?,?,?,?)"
    ).run(taskRoomId, roomId, name, emoji, "open", JSON.stringify([memberId]));
    return rowToTaskRoom(db.prepare("SELECT * FROM task_rooms WHERE id = ?").get(taskRoomId));
  },

  setTaskRoomStatus(taskRoomId: string, status: TaskRoomStatus) {
    db.prepare("UPDATE task_rooms SET status = ? WHERE id = ?").run(status, taskRoomId);
  },

  getTaskRoom(taskRoomId: string): TaskRoom | null {
    const r = db.prepare("SELECT * FROM task_rooms WHERE id = ?").get(taskRoomId);
    return r ? rowToTaskRoom(r) : null;
  },

  /** Owner bypasses; otherwise the caller must be listed on both the task
   * room itself and its parent room — the same two-level definition used by
   * getScopedState() below, so "can see it" and "can act in it" never diverge. */
  isTaskRoomMember(taskRoomId: string, memberId: string): boolean {
    if (repo.getMemberRole(memberId) === "owner") return true;
    const taskRoom = repo.getTaskRoom(taskRoomId);
    if (!taskRoom || !taskRoom.memberIds.includes(memberId)) return false;
    const room = repo.getRoom(taskRoom.roomId);
    return room ? room.memberIds.includes(memberId) : false;
  },

  /** Who an agent is "visible" to — and so who can @mention / DM it: the
   * owner, members of its home task room, and (for an agent attached to a
   * Room) that Room's members. Same rule scopes /api/state's agents. */
  canSeeAgent(memberId: string, agent: Agent): boolean {
    if (repo.getMemberRole(memberId) === "owner") return true;
    if (repo.isTaskRoomMember(agent.taskRoomId, memberId)) return true;
    return !!agent.roomId && repo.isRoomMember(agent.roomId, memberId);
  },

  /** Room-level equivalent of isTaskRoomMember, for routes scoped to a
   * Room's shared project folder rather than one Task Room within it. */
  isRoomMember(roomId: string, memberId: string): boolean {
    if (repo.getMemberRole(memberId) === "owner") return true;
    const room = repo.getRoom(roomId);
    return room ? room.memberIds.includes(memberId) : false;
  },

  // --- messages ---
  addMessage(
    taskRoomId: string,
    authorType: "member" | "agent",
    authorId: string,
    content: string,
    mentionedAgentIds: string[] = [],
    attachments: string[] = []
  ): ChatMessage {
    const messageId = id("msg");
    const createdAt = nowIso();
    db.prepare(
      "INSERT INTO messages (id, task_room_id, author_type, author_id, content, created_at, mentioned_agent_ids, attachments) VALUES (?,?,?,?,?,?,?,?)"
    ).run(
      messageId,
      taskRoomId,
      authorType,
      authorId,
      content,
      createdAt,
      JSON.stringify(mentionedAgentIds),
      JSON.stringify(attachments)
    );
    return rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId));
  },

  getMessagesForTaskRoom(taskRoomId: string): ChatMessage[] {
    return (stmtMessagesForTaskRoom.all(taskRoomId) as any[]).map(rowToMessage);
  },

  getMessage(messageId: string): ChatMessage | null {
    const r = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    return r ? rowToMessage(r) : null;
  },

  updateMessage(messageId: string, content: string) {
    db.prepare("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?").run(content, nowIso(), messageId);
  },

  deleteMessage(messageId: string) {
    db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
  },

  // --- direct messages ---
  addDirectMessage(
    agentId: string,
    authorType: "member" | "agent",
    content: string,
    authorId: string | null,
    memberId: string
  ): DirectMessage {
    const dmId = id("dm");
    const createdAt = nowIso();
    db.prepare(
      "INSERT INTO direct_messages (id, agent_id, author_type, author_id, member_id, content, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(dmId, agentId, authorType, authorId, memberId, content, createdAt);
    return rowToDm(db.prepare("SELECT * FROM direct_messages WHERE id = ?").get(dmId));
  },

  /** One member's private thread with an agent. */
  getDirectMessagesForAgent(agentId: string, memberId: string): DirectMessage[] {
    return (stmtDirectMessagesForAgent.all(agentId, memberId) as any[]).map(rowToDm);
  },

  getDirectMessage(dmId: string): DirectMessage | null {
    const r = db.prepare("SELECT * FROM direct_messages WHERE id = ?").get(dmId);
    return r ? rowToDm(r) : null;
  },

  updateDirectMessage(dmId: string, content: string) {
    db.prepare("UPDATE direct_messages SET content = ?, edited_at = ? WHERE id = ?").run(content, nowIso(), dmId);
  },

  deleteDirectMessage(dmId: string) {
    db.prepare("DELETE FROM direct_messages WHERE id = ?").run(dmId);
  },

  // --- agents ---
  createAgent(params: {
    taskRoomId: string;
    name: string;
    instructions: string;
    color: string;
    avatarEmoji: string;
    model: string;
    runtimeId: string;
    createdById: string;
    toolIds?: string[];
  }): Agent {
    const agentId = id("agent");
    db.prepare(
      `INSERT INTO agents (id, task_room_id, name, color, avatar_emoji, model, runtime_id, instructions, status, created_by_id, grants)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      agentId,
      params.taskRoomId,
      params.name,
      params.color,
      params.avatarEmoji,
      params.model,
      params.runtimeId,
      params.instructions,
      "idle",
      params.createdById,
      JSON.stringify(
        (params.toolIds ?? []).map((toolId) => ({ toolId, grantedById: params.createdById, grantedAt: nowIso() }))
      )
    );
    return rowToAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId));
  },

  updateAgentConfig(agentId: string, params: { model: string; runtimeId: string }) {
    db.prepare("UPDATE agents SET model = ?, runtime_id = ? WHERE id = ?").run(
      params.model,
      params.runtimeId,
      agentId
    );
  },

  getAgent(agentId: string): Agent | null {
    const r = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    return r ? rowToAgent(r) : null;
  },

  /** Every agent, unscoped — agents are workspace-wide (mentionable from any
   * room), so this is also the mention/handoff candidate list. */
  getAllAgents(): Agent[] {
    return (stmtAllAgents.all() as any[]).map(rowToAgent);
  },

  getAgentsForRoom(roomId: string): Agent[] {
    return (db.prepare("SELECT * FROM agents WHERE room_id = ?").all(roomId) as any[]).map(rowToAgent);
  },

  addAgentToRoom(agentId: string, roomId: string) {
    db.prepare("UPDATE agents SET room_id = ? WHERE id = ?").run(roomId, agentId);
  },

  removeAgentFromRoom(agentId: string) {
    db.prepare("UPDATE agents SET room_id = NULL WHERE id = ?").run(agentId);
  },

  addTeamToRoom(teamId: string, roomId: string): Agent[] {
    const team = repo.getAgentTeam(teamId);
    if (!team) return [];
    for (const agentId of team.agentIds) repo.addAgentToRoom(agentId, roomId);
    return team.agentIds.map((agentId) => repo.getAgent(agentId)).filter((a): a is Agent => a !== null);
  },

  toggleAgentTool(agentId: string, toolId: string, memberId: string) {
    const agent = repo.getAgent(agentId);
    if (!agent) return;
    const hasGrant = agent.grants.some((g) => g.toolId === toolId);
    const grants = hasGrant
      ? agent.grants.filter((g) => g.toolId !== toolId)
      : [...agent.grants, { toolId, grantedById: memberId, grantedAt: nowIso() }];
    db.prepare("UPDATE agents SET grants = ? WHERE id = ?").run(JSON.stringify(grants), agentId);
  },

  setAgentStatus(agentId: string, status: Agent["status"]) {
    db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, agentId);
  },

  removeAgent(agentId: string) {
    db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
  },

  // --- agent teams ---
  createAgentTeam(name: string, agentIds: string[], mode: AgentTeamMode, createdById: string): AgentTeam {
    const teamId = id("team");
    db.prepare("INSERT INTO agent_teams (id, name, mode, agent_ids, created_by_id) VALUES (?,?,?,?,?)").run(
      teamId,
      name,
      mode,
      JSON.stringify(agentIds),
      createdById
    );
    return rowToTeam(db.prepare("SELECT * FROM agent_teams WHERE id = ?").get(teamId));
  },

  removeAgentTeam(teamId: string) {
    db.prepare("DELETE FROM agent_teams WHERE id = ?").run(teamId);
  },

  getAgentTeam(teamId: string): AgentTeam | null {
    const r = db.prepare("SELECT * FROM agent_teams WHERE id = ?").get(teamId);
    return r ? rowToTeam(r) : null;
  },

  addTeamToTaskRoom(teamId: string, taskRoomId: string, memberId: string): Agent[] {
    const team = repo.getAgentTeam(teamId);
    if (!team) return [];
    const clones: Agent[] = [];
    for (const sourceId of team.agentIds) {
      const source = repo.getAgent(sourceId);
      if (!source) continue;
      clones.push(
        repo.createAgent({
          taskRoomId,
          name: source.name,
          instructions: source.instructions,
          color: source.color,
          avatarEmoji: source.avatarEmoji,
          model: source.model,
          runtimeId: source.runtimeId,
          createdById: memberId,
          toolIds: source.grants.map((g) => g.toolId),
        })
      );
    }
    return clones;
  },

  // --- workflows ---
  createWorkflow(taskRoomId: string, name: string, description: string): Workflow {
    const workflowId = id("wf");
    db.prepare(
      "INSERT INTO workflows (id, task_room_id, name, description, status, steps) VALUES (?,?,?,?,?,?)"
    ).run(workflowId, taskRoomId, name, description, "draft", "[]");
    return rowToWorkflow(db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId));
  },

  getWorkflow(workflowId: string): Workflow | null {
    const r = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId);
    return r ? rowToWorkflow(r) : null;
  },

  toggleWorkflowStep(workflowId: string, stepId: string) {
    const wf = repo.getWorkflow(workflowId);
    if (!wf) return;
    const steps = wf.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s));
    const status = nextWorkflowStatus(steps, wf.status);
    db.prepare("UPDATE workflows SET steps = ?, status = ? WHERE id = ?").run(
      JSON.stringify(steps),
      status,
      workflowId
    );
  },

  addWorkflowStep(workflowId: string, name: string) {
    const wf = repo.getWorkflow(workflowId);
    if (!wf) return;
    const steps = [...wf.steps, { id: id("step"), name, done: false }];
    const status = nextWorkflowStatus(steps, wf.status);
    db.prepare("UPDATE workflows SET steps = ?, status = ? WHERE id = ?").run(
      JSON.stringify(steps),
      status,
      workflowId
    );
  },

  markWorkflowDone(workflowId: string) {
    db.prepare("UPDATE workflows SET status = 'done' WHERE id = ?").run(workflowId);
  },

  removeWorkflow(workflowId: string) {
    db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);
  },

  // --- loops ---
  createLoop(taskRoomId: string, name: string, schedule: string): Loop {
    const loopId = id("loop");
    db.prepare(
      "INSERT INTO loops (id, task_room_id, name, schedule, active, last_run, next_run) VALUES (?,?,?,?,?,?,?)"
    ).run(loopId, taskRoomId, name, schedule, 1, null, null);
    return rowToLoop(db.prepare("SELECT * FROM loops WHERE id = ?").get(loopId));
  },

  getLoop(loopId: string): Loop | null {
    const r = db.prepare("SELECT * FROM loops WHERE id = ?").get(loopId);
    return r ? rowToLoop(r) : null;
  },

  /** Active loops only — used by the scheduler's once-a-minute tick(), which
   * used to call the full getState() (every message, every DM, connection
   * checks, ...) just to reach `.loops`. Filtering `active = 1` in SQL also
   * skips rows tick() would immediately discard anyway. */
  getActiveLoops(): Loop[] {
    const runsByLoop = allLoopRuns();
    return (stmtActiveLoops.all() as any[]).map((r) => rowToLoop(r, runsByLoop));
  },

  toggleLoopActive(loopId: string) {
    const r = db.prepare("SELECT active FROM loops WHERE id = ?").get(loopId) as { active: number } | undefined;
    if (!r) return;
    db.prepare("UPDATE loops SET active = ? WHERE id = ?").run(r.active ? 0 : 1, loopId);
  },

  setLoopRun(loopId: string, lastRun: string | null, nextRun: string | null) {
    db.prepare("UPDATE loops SET last_run = ?, next_run = ? WHERE id = ?").run(lastRun, nextRun, loopId);
  },

  recordLoopRun(loopId: string, ranAt: string, outcome: string) {
    db.prepare("INSERT INTO loop_runs (id, loop_id, ran_at, outcome) VALUES (?,?,?,?)").run(
      id("loop-run"),
      loopId,
      ranAt,
      outcome
    );
  },

  removeLoop(loopId: string) {
    db.prepare("DELETE FROM loop_runs WHERE loop_id = ?").run(loopId);
    db.prepare("DELETE FROM loops WHERE id = ?").run(loopId);
  },

  // --- todos ---
  addTodo(taskRoomId: string, text: string, assigneeId: string | null, dueDate: string | null): TodoItem {
    const todoId = id("td");
    db.prepare(
      "INSERT INTO todos (id, task_room_id, text, done, assignee_id, due_date) VALUES (?,?,?,0,?,?)"
    ).run(todoId, taskRoomId, text, assigneeId, dueDate);
    return rowToTodo(db.prepare("SELECT * FROM todos WHERE id = ?").get(todoId));
  },

  getTodosForTaskRoom(taskRoomId: string): TodoItem[] {
    return (db.prepare("SELECT * FROM todos WHERE task_room_id = ?").all(taskRoomId) as any[]).map(rowToTodo);
  },

  getTodo(todoId: string): TodoItem | null {
    const r = db.prepare("SELECT * FROM todos WHERE id = ?").get(todoId);
    return r ? rowToTodo(r) : null;
  },

  toggleTodo(todoId: string) {
    const r = db.prepare("SELECT done FROM todos WHERE id = ?").get(todoId) as { done: number } | undefined;
    if (!r) return;
    db.prepare("UPDATE todos SET done = ? WHERE id = ?").run(r.done ? 0 : 1, todoId);
  },

  // --- agent defaults / behavior settings ---
  setAgentDefaults(defaults: AgentDefaults) {
    db.prepare("UPDATE agent_defaults SET model = ?, runtime_id = ?, instructions = ? WHERE id = 1").run(
      defaults.model,
      defaults.runtimeId,
      defaults.instructions
    );
  },

  setAgentBehaviorSetting<K extends keyof AgentBehaviorSettings>(key: K, value: boolean) {
    const column = key === "keepAddressedAgentsActive" ? "keep_addressed_agents_active" : "keep_awake_while_agents_active";
    db.prepare(`UPDATE agent_behavior_settings SET ${column} = ? WHERE id = 1`).run(value ? 1 : 0);
  },

  // --- runtimes ---
  installRuntime(runtimeId: string) {
    db.prepare("UPDATE agent_runtimes SET status = 'ready' WHERE id = ?").run(runtimeId);
  },

  // --- connections (credentials) ---
  /** Raw credential value for internal use by services. Never send over the API. */
  getConnectionValue(key: ConnectionKey): string | null {
    const row = db.prepare("SELECT value FROM connections WHERE key = ?").get(key) as
      | { value: string | null }
      | undefined;
    return row?.value ? decryptSecret(DATA_DIR, row.value) : null;
  },

  setConnection(key: ConnectionKey, value: string) {
    db.prepare(
      "INSERT INTO connections (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(key, encryptSecret(DATA_DIR, value), nowIso());
  },

  removeConnection(key: ConnectionKey) {
    db.prepare("DELETE FROM connections WHERE key = ?").run(key);
  },

  getConnectionStatuses(): ConnectionStatus[] {
    return (["anthropic", "openrouter", "github", "postgres", "slack", "linear"] as ConnectionKey[]).map(connectionStatus);
  },

  // --- auth ---
  getMember(memberId: string): Member | null {
    const r = db.prepare("SELECT * FROM members WHERE id = ?").get(memberId);
    return r ? rowToMember(r) : null;
  },

  getAllMembers(): Member[] {
    return (stmtAllMembers.all() as any[]).map(rowToMember);
  },

  /** Finds the member linked to this OAuth identity, or creates one — the
   * very first real account ever created becomes "owner", every one after
   * that is a plain "member". Wrapped in a transaction so that decision
   * (checked via oauth_identities being empty) is atomic even though this
   * runs after an awaited network round-trip to the provider. */
  findOrCreateMemberByOAuth(
    provider: string,
    providerUserId: string,
    profile: { name: string; email: string; avatarUrl: string | null }
  ): Member {
    const existing = db
      .prepare(
        `SELECT members.* FROM oauth_identities
         JOIN members ON members.id = oauth_identities.member_id
         WHERE oauth_identities.provider = ? AND oauth_identities.provider_user_id = ?`
      )
      .get(provider, providerUserId);
    if (existing) return rowToMember(existing);

    return db.transaction(() => {
      const isFirstAccount = (db.prepare("SELECT COUNT(*) as c FROM oauth_identities").get() as { c: number }).c === 0;
      const memberId = id("m");
      const palette = ["#5b5cff", "#00b389", "#ffb020", "#ff6b6b", "#8a5cf6", "#0ea5b7"];
      const initials = profile.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join("") || "?";
      // Turning auth on for a workspace that was used locally: the first
      // account (who becomes owner anyway) takes over the local member, so
      // their existing messages, DMs, rooms and teams stay theirs.
      const localMember = isFirstAccount ? repo.getMember(CURRENT_MEMBER_ID) : null;
      if (localMember) {
        db.prepare("UPDATE members SET name = ?, initials = ?, role = 'owner', email = ?, avatar_url = ? WHERE id = ?").run(
          profile.name,
          initials,
          profile.email,
          profile.avatarUrl,
          localMember.id
        );
        db.prepare(
          "INSERT INTO oauth_identities (id, member_id, provider, provider_user_id, created_at) VALUES (?,?,?,?,?)"
        ).run(id("oauth"), localMember.id, provider, providerUserId, nowIso());
        return repo.getMember(localMember.id)!;
      }
      const color = palette[Math.floor(Math.random() * palette.length)];
      db.prepare("INSERT INTO members (id, name, initials, color, role, email, avatar_url) VALUES (?,?,?,?,?,?,?)").run(
        memberId,
        profile.name,
        initials,
        color,
        isFirstAccount ? "owner" : "member",
        profile.email,
        profile.avatarUrl
      );
      db.prepare(
        "INSERT INTO oauth_identities (id, member_id, provider, provider_user_id, created_at) VALUES (?,?,?,?,?)"
      ).run(id("oauth"), memberId, provider, providerUserId, nowIso());
      return repo.getMember(memberId)!;
    })();
  },

  createSession(memberId: string): string {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60_000); // 30 days
    db.prepare("INSERT INTO sessions (token, member_id, created_at, expires_at) VALUES (?,?,?,?)").run(
      token,
      memberId,
      now.toISOString(),
      expires.toISOString()
    );
    return token;
  },

  getSessionMember(token: string): Member | null {
    const row = db
      .prepare(
        `SELECT members.* FROM sessions
         JOIN members ON members.id = sessions.member_id
         WHERE sessions.token = ? AND sessions.expires_at > ?`
      )
      .get(token, nowIso());
    return row ? rowToMember(row) : null;
  },

  deleteSession(token: string) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  },
};

function nextWorkflowStatus(steps: WorkflowStep[], currentStatus: Workflow["status"]): Workflow["status"] {
  if (steps.length > 0 && steps.every((s) => s.done)) return "done";
  if (currentStatus === "done") return steps.length > 0 ? "running" : currentStatus;
  return currentStatus;
}
