import type {
  Agent,
  AgentBehaviorSettings,
  AgentDefaults,
  AgentRuntime,
  AgentTeam,
  AgentTeamMode,
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
} from "./types";

// The Hivemark backend (apps/server) always runs on localhost — in dev it's started
// separately, in the packaged app Electron spawns it as a child process (see apps/desktop).
const BACKEND_URL = "http://localhost:4001";
const WS_URL = "ws://localhost:4001/ws";

export type BackendState = {
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
  currentMemberId: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchState(): Promise<BackendState> {
  return request<BackendState>("/api/state");
}

export function fetchConnections(): Promise<ConnectionStatus[]> {
  return fetchState().then((s) => s.connections);
}

export function setConnection(key: ConnectionKey, value: string): Promise<void> {
  return request(`/api/connections/${key}`, { method: "PUT", body: JSON.stringify({ value }) });
}

export function removeConnection(key: ConnectionKey): Promise<void> {
  return request(`/api/connections/${key}`, { method: "DELETE" });
}

/** Opens the sync WebSocket and calls `onSync` on every `{type:"sync"}` push,
 * reconnecting with a fixed backoff if the connection drops. Returns a cleanup fn. */
export function connectSync(onSync: () => void): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function connect() {
    socket = new WebSocket(WS_URL);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "sync") onSync();
      } catch {
        // ignore malformed frames
      }
    };
    socket.onclose = () => {
      if (closed) return;
      reconnectTimer = setTimeout(connect, 2000);
    };
  }
  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}

// --- rooms ---
export function createRoom(name: string, emoji: string): Promise<Room> {
  return request("/api/rooms", { method: "POST", body: JSON.stringify({ name, emoji }) });
}
export function addMemberToRoom(roomId: string, memberId: string): Promise<void> {
  return request(`/api/rooms/${roomId}/members`, { method: "POST", body: JSON.stringify({ memberId }) });
}
export function removeMemberFromRoom(roomId: string, memberId: string): Promise<void> {
  return request(`/api/rooms/${roomId}/members/${memberId}`, { method: "DELETE" });
}

// --- task rooms ---
export function createTaskRoom(roomId: string, name: string, emoji: string): Promise<TaskRoom> {
  return request("/api/task-rooms", { method: "POST", body: JSON.stringify({ roomId, name, emoji }) });
}
export function setTaskRoomStatus(taskRoomId: string, status: TaskRoomStatus): Promise<void> {
  return request(`/api/task-rooms/${taskRoomId}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

// --- messages / DMs ---
export function sendMessage(taskRoomId: string, content: string): Promise<ChatMessage> {
  return request(`/api/task-rooms/${taskRoomId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}
export function sendDirectMessage(agentId: string, content: string): Promise<DirectMessage> {
  return request(`/api/agents/${agentId}/dm`, { method: "POST", body: JSON.stringify({ content }) });
}

// --- agents ---
export function createAgent(params: {
  taskRoomId: string;
  name: string;
  instructions: string;
  color: string;
  avatarEmoji: string;
  model: string;
  runtimeId: string;
}): Promise<Agent> {
  return request("/api/agents", { method: "POST", body: JSON.stringify(params) });
}
export function toggleAgentTool(agentId: string, toolId: string): Promise<void> {
  return request(`/api/agents/${agentId}/tools/${toolId}`, { method: "PATCH" });
}
export function removeAgent(agentId: string): Promise<void> {
  return request(`/api/agents/${agentId}`, { method: "DELETE" });
}
export function runAgent(agentId: string): Promise<void> {
  return request(`/api/agents/${agentId}/run`, { method: "POST" });
}
export function stopAgent(agentId: string): Promise<void> {
  return request(`/api/agents/${agentId}/stop`, { method: "POST" });
}
export function stopAllAgents(): Promise<void> {
  return request("/api/agents/stop-all", { method: "POST" });
}

// --- agent teams ---
export function createAgentTeam(name: string, agentIds: string[], mode: AgentTeamMode): Promise<AgentTeam> {
  return request("/api/agent-teams", { method: "POST", body: JSON.stringify({ name, agentIds, mode }) });
}
export function removeAgentTeam(teamId: string): Promise<void> {
  return request(`/api/agent-teams/${teamId}`, { method: "DELETE" });
}
export function addTeamToTaskRoom(teamId: string, taskRoomId: string): Promise<Agent[]> {
  return request(`/api/agent-teams/${teamId}/add-to-room`, {
    method: "POST",
    body: JSON.stringify({ taskRoomId }),
  });
}

// --- workflows ---
export function createWorkflow(taskRoomId: string, name: string, description: string): Promise<Workflow> {
  return request("/api/workflows", { method: "POST", body: JSON.stringify({ taskRoomId, name, description }) });
}
export function addWorkflowStep(workflowId: string, name: string): Promise<void> {
  return request(`/api/workflows/${workflowId}/steps`, { method: "POST", body: JSON.stringify({ name }) });
}
export function toggleWorkflowStep(workflowId: string, stepId: string): Promise<void> {
  return request(`/api/workflows/${workflowId}/steps/${stepId}`, { method: "PATCH" });
}
export function markWorkflowDone(workflowId: string): Promise<void> {
  return request(`/api/workflows/${workflowId}/complete`, { method: "POST" });
}
export function removeWorkflow(workflowId: string): Promise<void> {
  return request(`/api/workflows/${workflowId}`, { method: "DELETE" });
}

// --- loops ---
export function createLoop(taskRoomId: string, name: string, schedule: string): Promise<Loop> {
  return request("/api/loops", { method: "POST", body: JSON.stringify({ taskRoomId, name, schedule }) });
}
export function toggleLoopActive(loopId: string): Promise<void> {
  return request(`/api/loops/${loopId}/toggle`, { method: "PATCH" });
}
export function removeLoop(loopId: string): Promise<void> {
  return request(`/api/loops/${loopId}`, { method: "DELETE" });
}

// --- todos ---
export function addTodo(
  taskRoomId: string,
  text: string,
  assigneeId: string | null,
  dueDate: string | null
): Promise<TodoItem> {
  return request("/api/todos", { method: "POST", body: JSON.stringify({ taskRoomId, text, assigneeId, dueDate }) });
}
export function toggleTodo(todoId: string): Promise<void> {
  return request(`/api/todos/${todoId}/toggle`, { method: "PATCH" });
}

// --- agent defaults / behavior / runtimes ---
export function setAgentDefaults(defaults: AgentDefaults): Promise<void> {
  return request("/api/agent-defaults", { method: "PUT", body: JSON.stringify(defaults) });
}
export function setAgentBehaviorSetting<K extends keyof AgentBehaviorSettings>(
  key: K,
  value: AgentBehaviorSettings[K]
): Promise<void> {
  return request("/api/agent-behavior-settings", { method: "PATCH", body: JSON.stringify({ key, value }) });
}
export function installRuntime(runtimeId: string): Promise<void> {
  return request(`/api/agent-runtimes/${runtimeId}/install`, { method: "POST" });
}
