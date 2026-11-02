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
  DirEntry,
  FileContent,
  FileListing,
  Loop,
  McpTool,
  Member,
  PreviewState,
  Room,
  TaskRoom,
  TaskRoomStatus,
  TodoItem,
  Workflow,
} from "./types";
import { clearToken, getToken } from "./auth";

declare global {
  interface Window {
    /** Bridged from apps/desktop/src/preload.js — present only inside the
     * Electron app, absent in a plain browser. */
    hivemark?: {
      backendUrl: string | null;
      setServerUrl: (url: string) => Promise<void>;
      useLocalServer: () => Promise<void>;
    };
  }
}

// Resolution order: (1) Electron's runtime-injected server URL (set via the
// "Connect to Server…" menu, see apps/desktop) — lets one packaged desktop
// build connect to any self-hosted server without a rebuild; (2) the
// build-time NEXT_PUBLIC_BACKEND_URL for a self-hosted *web* deployment
// (baked in by `next build`, each deployment needs its own build); (3) the
// always-localhost default for local dev / Electron spawning its own backend.
export const BACKEND_URL =
  (typeof window !== "undefined" && window.hivemark?.backendUrl) ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4001";
const WS_URL = BACKEND_URL.replace(/^http/, "ws") + "/ws";

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
  sync?: { seq: number; scope: string; delta: boolean; deleted: { messages: string[]; directMessages: string[] } };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) clearToken();
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- auth ---
export function getAuthProviders(): Promise<{ providers: string[] }> {
  return request("/api/auth/providers");
}
/** `return` brings the browser back here after login — the server only
 * honours its own web frontend or a loopback address (the desktop app). */
export function loginUrl(provider: string): string {
  return `${BACKEND_URL}/api/auth/${provider}/login?return=${encodeURIComponent(window.location.origin + "/")}`;
}
export function exchangeAuthCode(code: string): Promise<{ token: string }> {
  return request("/api/auth/exchange", { method: "POST", body: JSON.stringify({ code }) });
}
export function fetchMe(): Promise<Member> {
  return request("/api/auth/me");
}
export function logout(): Promise<void> {
  return request("/api/auth/session", { method: "DELETE" });
}

/** With `since` (the last state's sync cursor), messages/directMessages hold
 * only what changed — see `sync.delta`. */
export function fetchState(since?: { seq: number; scope: string } | null): Promise<BackendState> {
  return request<BackendState>(since ? `/api/state?since=${since.seq}&scope=${encodeURIComponent(since.scope)}` : "/api/state");
}

/** The provider's current models (empty if the server can't ask it). */
export function fetchModels(provider: "anthropic" | "openrouter" | "codex"): Promise<string[]> {
  return request<{ models: string[] }>(`/api/models?provider=${provider}`).then((r) => r.models);
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
 * reconnecting with a fixed backoff if the connection drops. Returns a cleanup fn.
 *
 * The backend fires a `sync` push on essentially every mutation anywhere in the
 * workspace, so a burst of closely-spaced mutations (e.g. an agent posting
 * several messages in a row) can otherwise trigger a full `/api/state` refetch
 * per push. The caller debounces (the store's refresh()), which also merges a
 * push with the refetch the mutating action itself triggers. */
export function connectSync(onSync: () => void): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  let reconnecting = false;

  function connect() {
    const token = getToken();
    socket = new WebSocket(token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL);
    // Pushes sent while we were disconnected are lost — resync once back.
    socket.onopen = () => {
      if (reconnecting) onSync();
      reconnecting = false;
    };
    socket.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).type === "sync") onSync();
      } catch {
        // ignore malformed frames
      }
    };
    socket.onclose = () => {
      if (closed) return;
      reconnecting = true;
      onSync(); // fails while the backend is down, which is what shows the offline banner
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
export function addAgentToRoom(roomId: string, agentId: string): Promise<void> {
  return request(`/api/rooms/${roomId}/agents`, { method: "POST", body: JSON.stringify({ agentId }) });
}
export function removeAgentFromRoom(roomId: string, agentId: string): Promise<void> {
  return request(`/api/rooms/${roomId}/agents/${agentId}`, { method: "DELETE" });
}
export function addTeamToRoom(roomId: string, teamId: string): Promise<Agent[]> {
  return request(`/api/rooms/${roomId}/agent-teams`, { method: "POST", body: JSON.stringify({ teamId }) });
}

// --- task rooms ---
export function createTaskRoom(roomId: string, name: string, emoji: string): Promise<TaskRoom> {
  return request("/api/task-rooms", { method: "POST", body: JSON.stringify({ roomId, name, emoji }) });
}
export function setTaskRoomStatus(taskRoomId: string, status: TaskRoomStatus): Promise<void> {
  return request(`/api/task-rooms/${taskRoomId}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

// --- messages / DMs ---
export function sendMessage(taskRoomId: string, content: string, attachments: string[] = []): Promise<ChatMessage> {
  return request(`/api/task-rooms/${taskRoomId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, attachments }),
  });
}
export function sendDirectMessage(agentId: string, content: string): Promise<DirectMessage> {
  return request(`/api/agents/${agentId}/dm`, { method: "POST", body: JSON.stringify({ content }) });
}
export function editMessage(messageId: string, content: string): Promise<void> {
  return request(`/api/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ content }) });
}
export function deleteMessage(messageId: string): Promise<void> {
  return request(`/api/messages/${messageId}`, { method: "DELETE" });
}
export function editDirectMessage(dmId: string, content: string): Promise<void> {
  return request(`/api/direct-messages/${dmId}`, { method: "PATCH", body: JSON.stringify({ content }) });
}
export function deleteDirectMessage(dmId: string): Promise<void> {
  return request(`/api/direct-messages/${dmId}`, { method: "DELETE" });
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
  toolIds?: string[];
}): Promise<Agent> {
  return request("/api/agents", { method: "POST", body: JSON.stringify(params) });
}
export function toggleAgentTool(agentId: string, toolId: string): Promise<void> {
  return request(`/api/agents/${agentId}/tools/${toolId}`, { method: "PATCH" });
}
export function updateAgentConfig(agentId: string, config: { model: string; runtimeId: string }): Promise<void> {
  return request(`/api/agents/${agentId}/config`, { method: "PATCH", body: JSON.stringify(config) });
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
export function installMcpTool(toolId: string): Promise<void> {
  return request(`/api/mcp-tools/${toolId}/install`, { method: "POST" });
}

// --- files ---
export function listAgentFiles(agentId: string): Promise<FileListing> {
  return request(`/api/agents/${agentId}/files`);
}
/** Downloads via fetch (not a plain `<a href>`) so the auth bearer token is
 * sent — a bare link wouldn't carry it when real multi-user auth is on. */
async function downloadViaUrl(url: string, suggestedName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(objectUrl);
}
export function downloadAgentFile(agentId: string, path: string): Promise<void> {
  return downloadViaUrl(
    `${BACKEND_URL}/api/agents/${agentId}/files/download?path=${encodeURIComponent(path)}`,
    path.split("/").pop()!
  );
}

// --- room project (the real, shared Finder) ---
export function listRoomFiles(roomId: string, dirPath: string): Promise<DirEntry[]> {
  return request(`/api/rooms/${roomId}/project/files?path=${encodeURIComponent(dirPath)}`);
}
export function getRoomFileContent(roomId: string, filePath: string): Promise<FileContent> {
  return request(`/api/rooms/${roomId}/project/files/content?path=${encodeURIComponent(filePath)}`);
}
export function downloadRoomFile(roomId: string, filePath: string): Promise<void> {
  return downloadViaUrl(
    `${BACKEND_URL}/api/rooms/${roomId}/project/files/download?path=${encodeURIComponent(filePath)}`,
    filePath.split("/").pop()!
  );
}
export function createRoomFile(roomId: string, targetPath: string, type: "file" | "dir"): Promise<void> {
  return request(`/api/rooms/${roomId}/project/files`, {
    method: "POST",
    body: JSON.stringify({ path: targetPath, type }),
  });
}
/** Raw file body, always sent as octet-stream — the server's JSON body
 * parser would otherwise swallow an uploaded .json file. */
export function uploadRoomFile(
  roomId: string,
  targetPath: string,
  file: Blob,
  overwrite = false
): Promise<{ path: string }> {
  return request(`/api/rooms/${roomId}/project/upload?path=${encodeURIComponent(targetPath)}${overwrite ? "&overwrite=1" : ""}`, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": "application/octet-stream" },
  });
}
/** A project file's bytes via the authenticated, membership-checked route —
 * for showing images inline (see AuthImage). */
export async function fetchRoomFileBlob(roomId: string, filePath: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(
    `${BACKEND_URL}/api/rooms/${roomId}/project/files/download?path=${encodeURIComponent(filePath)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) throw new Error(`Couldn't load ${filePath}: ${res.status}`);
  return res.blob();
}
export function isImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(filePath);
}
export function deleteRoomFile(roomId: string, targetPath: string): Promise<void> {
  return request(`/api/rooms/${roomId}/project/files?path=${encodeURIComponent(targetPath)}`, { method: "DELETE" });
}
export function renameRoomFile(roomId: string, from: string, to: string): Promise<void> {
  return request(`/api/rooms/${roomId}/project/files`, { method: "PATCH", body: JSON.stringify({ from, to }) });
}

// --- room preview ---
export function getPreviewStatus(roomId: string): Promise<PreviewState> {
  return request(`/api/rooms/${roomId}/preview/status`);
}
export function startRoomPreview(roomId: string): Promise<PreviewState> {
  return request(`/api/rooms/${roomId}/preview/start`, { method: "POST" });
}
export function stopRoomPreview(roomId: string): Promise<PreviewState> {
  return request(`/api/rooms/${roomId}/preview/stop`, { method: "POST" });
}
/** The status route returns a same-origin path for static rooms
 * ("/preview-static/<id>/"), or for a live node dev server a `proxy://<port>/`
 * marker — the server proxies the dev server's raw bytes (HTTP + WebSocket
 * HMR) through a TCP forward on that port, so we just need to swap in
 * whatever host we're already using to reach BACKEND_URL. That makes live
 * previews work in self-hosted/remote deployments the same way the REST API
 * already does, not just when the viewer is on the same machine as the
 * server. */
export function resolvePreviewUrl(url: string): string {
  if (url.startsWith("proxy://")) {
    const port = url.slice("proxy://".length).split("/")[0];
    return `http://${new URL(BACKEND_URL).hostname}:${port}/`;
  }
  return url.startsWith("/") ? `${BACKEND_URL}${url}` : url;
}

export type ClaudeCodeAuthStatus = {
  available: boolean;
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
};

export function getClaudeCodeAuthStatus(): Promise<ClaudeCodeAuthStatus> {
  return request("/api/runtimes/claude-code/status");
}

export function triggerClaudeCodeLogin(): Promise<void> {
  return request("/api/runtimes/claude-code/login", { method: "POST" });
}
