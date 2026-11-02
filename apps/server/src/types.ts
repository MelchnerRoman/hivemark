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
};

export type DirectMessage = {
  id: string;
  agentId: string;
  authorType: "member" | "agent";
  /** Which member sent this, for member-authored rows. Null for agent-authored
   * rows, and for rows written before this field existed. */
  authorId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
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

export type WorkspaceTab = "chat" | "workflows" | "loops" | "todos" | "agents";

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
  agentTeams: AgentTeam[];
  agentRuntimes: AgentRuntime[];
  agentBehaviorSettings: AgentBehaviorSettings;
  agentDefaults: AgentDefaults;
  workflows: Workflow[];
  loops: Loop[];
  todos: TodoItem[];
  connections: ConnectionStatus[];
};

export type WsMessage = { type: "sync" };
