export type Member = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: "owner" | "member";
};

export type McpTool = {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "ready" | "needs_setup";
  /** Owner-added server (id "mcp-custom-<slug>"). Only the owner gets command/args/url/secretNames. */
  custom?: {
    kind: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    secretNames?: string[];
  };
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
  /** While running: the conversation it's replying in, if the caller can
   * see it (a task room of theirs, or their own DM with it). */
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

export type AppView = "rooms" | "agents" | "dm";

/** Extra detail on an agent-authored message. */
export type MessageMeta = {
  /** Tools the agent called during the turn this message ends. */
  tools?: { name: string; input?: string }[];
  /** The "Stopped by …" trace left when a member stops a turn. */
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
  /** Whose private 1:1 thread this is (the server only sends your own). */
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

export type WorkspaceTab = "chat" | "workflows" | "loops" | "todos" | "agents" | "files" | "preview";

export type SharedFile = {
  path: string;
  size: number;
  modifiedAt: string;
};

export type FileListing = {
  files: SharedFile[];
  truncated: boolean;
};

export type DirEntry = {
  name: string;
  type: "file" | "dir";
  size: number;
  modifiedAt: string;
};

export type FileContent = { content: string } | { binary: true } | { tooLarge: true };

export type PreviewMode = "static" | "node" | "none";
export type PreviewStatus = "stopped" | "starting" | "running" | "error";

export type PreviewState = {
  mode: PreviewMode;
  status: PreviewStatus;
  url: string | null;
  logTail: string[];
  pid: number | null;
};

export type ConnectionKey = "anthropic" | "openrouter" | "github" | "postgres" | "slack" | "linear";

export type ConnectionStatus = {
  key: ConnectionKey;
  label: string;
  connected: boolean;
  hint: string | null;
};
