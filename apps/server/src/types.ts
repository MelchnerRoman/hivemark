export type Member = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: "owner" | "member";
  email?: string;
  avatarUrl?: string;
};

export type McpTool = {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Only set on the /api/state response for tools that need a one-time local
   * setup step (e.g. downloading a browser binary) before they'll work. Not
   * persisted — computed live by checking the machine's actual state. */
  status?: "ready" | "needs_setup";
  /** Set for owner-added servers (id "mcp-custom-<slug>"). command/args/url
   * and secretNames are only sent to the owner; secret values never leave
   * the server. */
  custom?: CustomMcpPublic;
};

export type CustomMcpPublic = {
  kind: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** Names of the stored env vars (stdio) or headers (http) — never values. */
  secretNames?: string[];
};

export type AgentGrant = {
  toolId: string;
  grantedById: string;
  grantedAt: string;
};

export type Agent = {
  id: string;
  /** The Task Room this agent was created in — always set, shown as "Created in X". */
  taskRoomId: string;
  /** When set, this agent is also mentionable/usable in every Task Room within this
   * Room (not just its home Task Room). Null = task-room-scoped only (original behavior). */
  roomId: string | null;
  name: string;
  color: string;
  avatarEmoji: string;
  model: string;
  runtimeId: string;
  instructions: string;
  status: "idle" | "running" | "error";
  createdById: string;
  grants: AgentGrant[];
  /** /api/state only, while status is "running": which conversation the
   * current turn is for — a task room the caller can see, or the caller's
   * own DM with this agent. Absent for anything else (another member's DM,
   * a task room the caller isn't in). */
  activeTurn?: { taskRoomId: string } | { dm: true };
};

export type AgentDefaults = {
  model: string;
  runtimeId: string;
  instructions: string;
};

export type RuntimeStatus = "ready" | "cli_needed";

export type AgentRuntime = {
  id: string;
  name: string;
  icon: string;
  status: RuntimeStatus;
  description: string;
  installHint?: string;
  setupUrl?: string;
};

export type AgentBehaviorSettings = {
  keepAddressedAgentsActive: boolean;
  keepAwakeWhileAgentsActive: boolean;
};

export type AgentTeamMode = "auto" | "manual";

export type AgentTeam = {
  id: string;
  name: string;
  mode: AgentTeamMode;
  agentIds: string[];
  /** Who made it — they (and the workspace owner) can delete it. Null for
   * teams created before this was recorded: owner only. */
  createdById: string | null;
};

/** Extra detail on an agent-authored message. */
export type MessageMeta = {
  /** Tools the agent called during the turn this message ends (capped,
   * inputs truncated). */
  tools?: { name: string; input?: string }[];
  /** Set on the "Stopped by …" trace left when a member stops a turn —
   * that member's id. Not sent to the model as history. */
  stoppedBy?: string;
};

export type ChatMessage = {
  id: string;
  taskRoomId: string;
  authorType: "member" | "agent";
  authorId: string;
  content: string;
  createdAt: string;
  mentionedAgentIds?: string[];
  /** Paths inside the Room's shared project folder (see agentSandbox.ts). */
  attachments: string[];
  editedAt: string | null;
  meta?: MessageMeta;
};

export type DirectMessage = {
  id: string;
  agentId: string;
  authorType: "member" | "agent";
  /** Which member sent this, for member-authored rows. Null for agent-authored
   * rows, and for rows written before this field existed. */
  authorId: string | null;
  /** Whose private 1:1 thread with the agent this belongs to — DMs are
   * per member, visible only to that member. */
  memberId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  meta?: MessageMeta;
};

export type WorkflowStep = {
  id: string;
  name: string;
  done: boolean;
};

export type Workflow = {
  id: string;
  taskRoomId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: "draft" | "running" | "done";
};

export type LoopRun = {
  timestamp: string;
  outcome: string;
};

export type Loop = {
  id: string;
  taskRoomId: string;
  name: string;
  schedule: string;
  active: boolean;
  lastRun: string | null;
  nextRun: string | null;
  /** Most recent runs, newest first. Real — recorded by the scheduler each time it fires. */
  runs: LoopRun[];
};

export type TodoItem = {
  id: string;
  taskRoomId: string;
  text: string;
  done: boolean;
  assigneeId: string | null;
  dueDate: string | null;
};

export type TaskRoomStatus = "open" | "in_progress" | "done";

export type TaskRoom = {
  id: string;
  roomId: string;
  name: string;
  emoji: string;
  status: TaskRoomStatus;
  memberIds: string[];
};

export type Room = {
  id: string;
  name: string;
  emoji: string;
  memberIds: string[];
  taskRoomIds: string[];
};

/** Connection keys the backend knows how to store a credential for. */
export type ConnectionKey = "anthropic" | "openrouter" | "github" | "postgres" | "slack" | "linear";

export type ConnectionStatus = {
  key: ConnectionKey;
  label: string;
  connected: boolean;
  /** Last 4 chars of the stored secret, for display only. Never the full value. */
  hint: string | null;
};

/** Full server-held app state, returned by GET /api/state and re-fetched by the
 * client on every WebSocket "sync" push. Selection/UI-only state (selectedRoomId,
 * view, etc.) is NOT part of this — it stays client-side in Zustand. */
export type AppState = {
  members: Member[];
  mcpTools: McpTool[];
  rooms: Room[];
  taskRooms: TaskRoom[];
  messages: ChatMessage[];
  directMessages: DirectMessage[];
  agents: Agent[];
  /** Name/look of agents the caller can't see that wrote messages in task
   * rooms they can — enough to render the message, nothing more. */
  messageAuthors?: Pick<Agent, "id" | "name" | "color" | "avatarEmoji">[];
  agentTeams: AgentTeam[];
  agentRuntimes: AgentRuntime[];
  agentBehaviorSettings: AgentBehaviorSettings;
  agentDefaults: AgentDefaults;
  workflows: Workflow[];
  loops: Loop[];
  todos: TodoItem[];
  connections: ConnectionStatus[];
  /** Incremental sync bookkeeping — see repo.getScopedState. */
  sync?: { seq: number; scope: string; delta: boolean; deleted: { messages: string[]; directMessages: string[] } };
};
