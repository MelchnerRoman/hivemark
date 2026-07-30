import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
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
  McpTool,
  Member,
  Room,
  TaskRoom,
  TaskRoomStatus,
  TodoItem,
  Workflow,
  WorkflowStep,
} from "./types.js";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");
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
  mentioned_agent_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  task_room_id TEXT NOT NULL,
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

-- Credentials. Values are stored in plaintext in this local sqlite file —
-- there is no encryption-at-rest here. Acceptable for a local-first desktop
-- app with a single user, but never expose this table's contents over the API.
CREATE TABLE IF NOT EXISTS connections (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
`);

// ---------------------------------------------------------------------------
// Seed (only runs once, when the members table is empty)
// ---------------------------------------------------------------------------

const CURRENT_MEMBER_ID = "m-roman";

function seedIfEmpty() {
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

  const insertTool = db.prepare("INSERT INTO mcp_tools (id, name, description, icon) VALUES (?,?,?,?)");
  const mcpTools: McpTool[] = [
    { id: "mcp-github", name: "GitHub", description: "Read/write repos, PRs, issues", icon: "code" },
    { id: "mcp-linear", name: "Linear", description: "Create and update tickets", icon: "list" },
    { id: "mcp-postgres", name: "Postgres", description: "Query the staging database", icon: "database" },
    { id: "mcp-browser", name: "Browser", description: "Navigate and read web pages", icon: "globe" },
    { id: "mcp-slack", name: "Slack Export", description: "Read message history for context", icon: "message" },
  ];
  for (const t of mcpTools) insertTool.run(t.id, t.name, t.description, t.icon);

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

  const insertRuntime = db.prepare(
    "INSERT INTO agent_runtimes (id, name, icon, status, description, install_hint, setup_url) VALUES (?,?,?,?,?,?,?)"
  );
  insertRuntime.run("runtime-hivemark", "Hivemark Agent", "🐝", "ready", "Runs natively inside Hivemark. No install needed.", null, null);
  insertRuntime.run("runtime-claude-code", "Claude Code", "✳️", "ready", "Hivemark talks to Claude Code directly.", null, null);
  insertRuntime.run("runtime-codex", "Codex", "⌨️", "cli_needed", "Hivemark talks to the Codex CLI through an ACP adapter.", "npm install -g @agentclientprotocol/codex-acp", "https://github.com/agentclientprotocol");
  insertRuntime.run("runtime-goose", "Goose", "🦢", "cli_needed", "Hivemark talks to Goose through the Goose CLI.", null, "https://block.github.io/goose/");

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

  db.prepare("INSERT INTO agent_defaults (id, model, runtime_id, instructions) VALUES (1, ?, ?, '')").run(
    "Claude Sonnet 5",
    "runtime-hivemark"
  );
  db.prepare(
    "INSERT INTO agent_behavior_settings (id, keep_addressed_agents_active, keep_awake_while_agents_active) VALUES (1, 0, 0)"
  ).run();
}

seedIfEmpty();

// ---------------------------------------------------------------------------
// Row <-> domain-type mapping helpers
// ---------------------------------------------------------------------------

function rowToRoom(r: any): Room {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    memberIds: JSON.parse(r.member_ids),
    taskRoomIds: (db.prepare("SELECT id FROM task_rooms WHERE room_id = ?").all(r.id) as any[]).map((t) => t.id),
  };
}

function rowToTaskRoom(r: any): TaskRoom {
  return {
    id: r.id,
    roomId: r.room_id,
    name: r.name,
    emoji: r.emoji,
    status: r.status as TaskRoomStatus,
    memberIds: JSON.parse(r.member_ids),
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
    mentionedAgentIds: JSON.parse(r.mentioned_agent_ids),
  };
}

function rowToDm(r: any): DirectMessage {
  return {
    id: r.id,
    agentId: r.agent_id,
    authorType: r.author_type,
    content: r.content,
    createdAt: r.created_at,
  };
}

function rowToAgent(r: any): Agent {
  return {
    id: r.id,
    taskRoomId: r.task_room_id,
    name: r.name,
    color: r.color,
    avatarEmoji: r.avatar_emoji,
    model: r.model,
    runtimeId: r.runtime_id,
    instructions: r.instructions,
    status: r.status,
    createdById: r.created_by_id,
    grants: JSON.parse(r.grants),
  };
}

function rowToTeam(r: any): AgentTeam {
  return { id: r.id, name: r.name, mode: r.mode as AgentTeamMode, agentIds: JSON.parse(r.agent_ids) };
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
    steps: JSON.parse(r.steps),
  };
}

function rowToLoop(r: any): Loop {
  return {
    id: r.id,
    taskRoomId: r.task_room_id,
    name: r.name,
    schedule: r.schedule,
    active: !!r.active,
    lastRun: r.last_run,
    nextRun: r.next_run,
  };
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
  github: "GitHub personal access token",
  postgres: "Postgres connection string",
  slack: "Slack bot token",
  linear: "Linear API key",
};

function connectionStatus(key: ConnectionKey): ConnectionStatus {
  const row = db.prepare("SELECT value FROM connections WHERE key = ?").get(key) as
    | { value: string | null }
    | undefined;
  const value = row?.value ?? null;
  return {
    key,
    label: CONNECTION_LABELS[key],
    connected: !!value,
    hint: value ? value.slice(-4) : null,
  };
}

// ---------------------------------------------------------------------------
// Repository — the only interface routes/services should use to touch the DB
// ---------------------------------------------------------------------------

export const repo = {
  currentMemberId: CURRENT_MEMBER_ID,

  getState(): AppState {
    return {
      members: (db.prepare("SELECT * FROM members").all() as any[]).map(
        (r): Member => ({ id: r.id, name: r.name, initials: r.initials, color: r.color, role: r.role })
      ),
      mcpTools: (db.prepare("SELECT * FROM mcp_tools").all() as any[]).map(
        (r): McpTool => ({ id: r.id, name: r.name, description: r.description, icon: r.icon })
      ),
      rooms: (db.prepare("SELECT * FROM rooms").all() as any[]).map(rowToRoom),
      taskRooms: (db.prepare("SELECT * FROM task_rooms").all() as any[]).map(rowToTaskRoom),
      messages: (db.prepare("SELECT * FROM messages ORDER BY created_at ASC").all() as any[]).map(rowToMessage),
      directMessages: (db.prepare("SELECT * FROM direct_messages ORDER BY created_at ASC").all() as any[]).map(
        rowToDm
      ),
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
      loops: (db.prepare("SELECT * FROM loops").all() as any[]).map(rowToLoop),
      todos: (db.prepare("SELECT * FROM todos").all() as any[]).map(rowToTodo),
      connections: (["anthropic", "github", "postgres", "slack", "linear"] as ConnectionKey[]).map(
        connectionStatus
      ),
      currentMemberId: CURRENT_MEMBER_ID,
    };
  },

  // --- rooms ---
  createRoom(name: string, emoji: string): Room {
    const roomId = id("room");
    db.prepare("INSERT INTO rooms (id, name, emoji, member_ids) VALUES (?,?,?,?)").run(
      roomId,
      name,
      emoji,
      JSON.stringify([CURRENT_MEMBER_ID])
    );
    return rowToRoom(db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId));
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

  // --- task rooms ---
  createTaskRoom(roomId: string, name: string, emoji: string): TaskRoom {
    const taskRoomId = id("tr");
    db.prepare(
      "INSERT INTO task_rooms (id, room_id, name, emoji, status, member_ids) VALUES (?,?,?,?,?,?)"
    ).run(taskRoomId, roomId, name, emoji, "open", JSON.stringify([CURRENT_MEMBER_ID]));
    return rowToTaskRoom(db.prepare("SELECT * FROM task_rooms WHERE id = ?").get(taskRoomId));
  },

  setTaskRoomStatus(taskRoomId: string, status: TaskRoomStatus) {
    db.prepare("UPDATE task_rooms SET status = ? WHERE id = ?").run(status, taskRoomId);
  },

  getTaskRoom(taskRoomId: string): TaskRoom | null {
    const r = db.prepare("SELECT * FROM task_rooms WHERE id = ?").get(taskRoomId);
    return r ? rowToTaskRoom(r) : null;
  },

  // --- messages ---
  addMessage(
    taskRoomId: string,
    authorType: "member" | "agent",
    authorId: string,
    content: string,
    mentionedAgentIds: string[] = []
  ): ChatMessage {
    const messageId = id("msg");
    const createdAt = nowIso();
    db.prepare(
      "INSERT INTO messages (id, task_room_id, author_type, author_id, content, created_at, mentioned_agent_ids) VALUES (?,?,?,?,?,?,?)"
    ).run(messageId, taskRoomId, authorType, authorId, content, createdAt, JSON.stringify(mentionedAgentIds));
    return rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId));
  },

  getMessagesForTaskRoom(taskRoomId: string): ChatMessage[] {
    return (
      db.prepare("SELECT * FROM messages WHERE task_room_id = ? ORDER BY created_at ASC").all(taskRoomId) as any[]
    ).map(rowToMessage);
  },

  // --- direct messages ---
  addDirectMessage(agentId: string, authorType: "member" | "agent", content: string): DirectMessage {
    const dmId = id("dm");
    const createdAt = nowIso();
    db.prepare(
      "INSERT INTO direct_messages (id, agent_id, author_type, content, created_at) VALUES (?,?,?,?,?)"
    ).run(dmId, agentId, authorType, content, createdAt);
    return rowToDm(db.prepare("SELECT * FROM direct_messages WHERE id = ?").get(dmId));
  },

  getDirectMessagesForAgent(agentId: string): DirectMessage[] {
    return (
      db.prepare("SELECT * FROM direct_messages WHERE agent_id = ? ORDER BY created_at ASC").all(agentId) as any[]
    ).map(rowToDm);
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
      CURRENT_MEMBER_ID,
      "[]"
    );
    return rowToAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId));
  },

  getAgent(agentId: string): Agent | null {
    const r = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    return r ? rowToAgent(r) : null;
  },

  getAgentsForTaskRoom(taskRoomId: string): Agent[] {
    return (db.prepare("SELECT * FROM agents WHERE task_room_id = ?").all(taskRoomId) as any[]).map(rowToAgent);
  },

  toggleAgentTool(agentId: string, toolId: string) {
    const agent = repo.getAgent(agentId);
    if (!agent) return;
    const hasGrant = agent.grants.some((g) => g.toolId === toolId);
    const grants = hasGrant
      ? agent.grants.filter((g) => g.toolId !== toolId)
      : [...agent.grants, { toolId, grantedById: CURRENT_MEMBER_ID, grantedAt: nowIso() }];
    db.prepare("UPDATE agents SET grants = ? WHERE id = ?").run(JSON.stringify(grants), agentId);
  },

  setAgentStatus(agentId: string, status: Agent["status"]) {
    db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, agentId);
  },

  removeAgent(agentId: string) {
    db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
  },

  // --- agent teams ---
  createAgentTeam(name: string, agentIds: string[], mode: AgentTeamMode): AgentTeam {
    const teamId = id("team");
    db.prepare("INSERT INTO agent_teams (id, name, mode, agent_ids) VALUES (?,?,?,?)").run(
      teamId,
      name,
      mode,
      JSON.stringify(agentIds)
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

  addTeamToTaskRoom(teamId: string, taskRoomId: string): Agent[] {
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

  toggleLoopActive(loopId: string) {
    const r = db.prepare("SELECT active FROM loops WHERE id = ?").get(loopId) as { active: number } | undefined;
    if (!r) return;
    db.prepare("UPDATE loops SET active = ? WHERE id = ?").run(r.active ? 0 : 1, loopId);
  },

  setLoopRun(loopId: string, lastRun: string | null, nextRun: string | null) {
    db.prepare("UPDATE loops SET last_run = ?, next_run = ? WHERE id = ?").run(lastRun, nextRun, loopId);
  },

  removeLoop(loopId: string) {
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
    return row?.value ?? null;
  },

  setConnection(key: ConnectionKey, value: string) {
    db.prepare(
      "INSERT INTO connections (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(key, value, nowIso());
  },

  removeConnection(key: ConnectionKey) {
    db.prepare("DELETE FROM connections WHERE key = ?").run(key);
  },

  getConnectionStatuses(): ConnectionStatus[] {
    return (["anthropic", "github", "postgres", "slack", "linear"] as ConnectionKey[]).map(connectionStatus);
  },
};

function nextWorkflowStatus(steps: WorkflowStep[], currentStatus: Workflow["status"]): Workflow["status"] {
  if (steps.length > 0 && steps.every((s) => s.done)) return "done";
  if (currentStatus === "done") return steps.length > 0 ? "running" : currentStatus;
  return currentStatus;
}
