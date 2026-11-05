import { create } from "zustand";
import * as api from "./api";
import { clearToken } from "./auth";
import type {
  Agent,
  AgentBehaviorSettings,
  AgentDefaults,
  AgentRuntime,
  AgentTeam,
  AgentTeamMode,
  AppView,
  ChatMessage,
  DirectMessage,
  Loop,
  McpTool,
  Member,
  Room,
  TaskRoom,
  TaskRoomStatus,
  TodoItem,
  Workflow,
  WorkspaceTab,
} from "./types";

function tempId(prefix: string) {
  return `tmp-${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

let hasHydratedOnce = false;
// Several hydrates can be in flight at once (action + WS sync); a response that
// arrives after a newer one was applied must not roll state back.
let hydrateSeq = 0;
let appliedHydrateSeq = 0;

/** Structural equality for plain JSON data. Used so hydrate() can keep the
 * previous object/array reference for any slice whose content didn't
 * actually change, instead of always swapping in the freshly-fetched
 * object. The backend fires a full resync on essentially every mutation
 * anywhere in the workspace, so without this every `useStore` selector
 * (even ones using useShallow or .find()) would see a "changed" reference
 * and re-render on every unrelated event, since the elements themselves —
 * not just the containing array — are brand-new objects each fetch. */
function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** For arrays this works per element (matched by id): one new chat message
 * must not hand every other message a fresh reference, or each filtered
 * useShallow selector (e.g. another Task Room's chat) re-renders anyway. */
export function keepIfSame<T>(prev: T, next: T): T {
  if (!Array.isArray(prev) || !Array.isArray(next)) return sameJSON(prev, next) ? prev : next;
  const byId = new Map(prev.map((x, i) => [x?.id ?? i, x]));
  let changed = prev.length !== next.length;
  const merged = next.map((x, i) => {
    const old = byId.get(x?.id ?? i);
    const kept = old !== undefined && sameJSON(old, x) ? old : x;
    if (kept !== prev[i]) changed = true;
    return kept;
  });
  return (changed ? merged : prev) as T;
}

/** Where the last applied /api/state left off: the next fetch asks only for
 * messages/DMs changed since then (the server falls back to a full state
 * when the scope — who we are, what we can see — changed). */
let syncCursor: { seq: number; scope: string } | null = null;

/** Applies an incremental messages/DMs update; unchanged items keep their
 * reference (so memoized rows don't re-render). */
function applyDelta<T extends { id: string; createdAt: string }>(prev: T[], changed: T[], deletedIds: string[]): T[] {
  if (!changed.length && !deletedIds.length) return prev;
  const gone = new Set([...deletedIds, ...changed.map((m) => m.id)]);
  return [...prev.filter((m) => !gone.has(m.id)), ...changed].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Swap an optimistic item for the server's saved one — unless the sync push
 * already brought it in, which can beat the POST's own response. */
function settle<T extends { id: string }>(list: T[], tempId: string, saved: T): T[] {
  const rest = list.filter((m) => m.id !== tempId);
  return rest.some((m) => m.id === saved.id) ? rest : [...rest, saved];
}

/** One shared, debounced refetch for both halves of a mutation: the action's
 * own HTTP response and the server's websocket "sync" push for that same
 * mutation land within a few ms of each other and used to fetch the full
 * state twice. Also used for bursts of pushes (an agent posting repeatedly). */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
export function refresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    useStore.getState().hydrate().then(
      () => useStore.getState().syncError && useStore.setState({ syncError: null }),
      (err) => useStore.setState({ syncError: err instanceof Error ? err.message : String(err) })
    );
  }, 150);
}

/** Shows an action's error in the app's error toast (page.tsx). */
export function showError(err: unknown) {
  useStore.setState({ actionError: err instanceof Error ? err.message : String(err) });
}

/** Failure path for actions: tell the user, and resync so an optimistic
 * change that never reached the server is rolled back. */
function fail(err: unknown) {
  showError(err);
  refresh();
}

/** Fires a real desktop notification for agent messages that just arrived while
 * this window wasn't focused. Skipped on the very first hydrate (app boot) so
 * loading history doesn't trigger a notification storm. */
function notifyNewAgentMessages(
  before: { messages: ChatMessage[]; directMessages: DirectMessage[] },
  after: { messages: ChatMessage[]; directMessages: DirectMessage[]; agents: Agent[] }
) {
  if (!hasHydratedOnce) return;
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (document.hasFocus()) return;

  const knownIds = new Set([...before.messages.map((m) => m.id), ...before.directMessages.map((m) => m.id)]);

  for (const m of after.messages) {
    if (m.authorType !== "agent" || knownIds.has(m.id)) continue;
    const agent = after.agents.find((a) => a.id === m.authorId);
    new Notification(agent?.name ?? "Agent", { body: m.content.slice(0, 200) });
  }
  for (const m of after.directMessages) {
    if (m.authorType !== "agent" || knownIds.has(m.id)) continue;
    const agent = after.agents.find((a) => a.id === m.agentId);
    new Notification(agent ? `${agent.name} (DM)` : "Agent", { body: m.content.slice(0, 200) });
  }
}

const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  model: "", // ModelInput picks the provider's newest Sonnet
  runtimeId: "runtime-hivemark",
  instructions: "",
};

const DEFAULT_AGENT_BEHAVIOR: AgentBehaviorSettings = {
  keepAddressedAgentsActive: false,
  keepAwakeWhileAgentsActive: false,
};

type Store = {
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
  workflows: Workflow[];
  loops: Loop[];
  todos: TodoItem[];

  currentMemberId: string;
  selectedRoomId: string | null;
  selectedTaskRoomId: string | null;
  selectedDmAgentId: string | null;
  activeTab: WorkspaceTab;
  view: AppView;
  agentDefaults: AgentDefaults;

  hydrate: () => Promise<void>;
  /** Last background-sync failure (backend unreachable), cleared on the next
   * successful sync. Shown as a banner instead of tearing the app down. */
  syncError: string | null;
  /** Last failed user action's message, shown as a dismissible toast. */
  actionError: string | null;
  /** Changes whenever the Anthropic key is set, replaced or removed — lets
   * ModelInput refetch the model list it determines. "" = not connected. */
  anthropicKey: string;
  /** Populates currentMemberId from /api/auth/me — called once on boot (see
   * page.tsx's login gate), separately from hydrate() since identity now
   * comes from the authenticated session, not the general state payload. */
  loadMe: () => Promise<void>;
  logout: () => Promise<void>;

  selectRoom: (roomId: string) => void;
  selectTaskRoom: (taskRoomId: string) => void;
  setActiveTab: (tab: WorkspaceTab) => void;
  setView: (view: AppView) => void;
  goToAgentInContext: (agentId: string) => void;
  openTaskRoom: (taskRoomId: string, tab?: WorkspaceTab) => void;
  openAgentDm: (agentId: string) => void;
  setAgentDefaults: (defaults: AgentDefaults) => void;
  setAgentBehaviorSetting: <K extends keyof AgentBehaviorSettings>(key: K, value: AgentBehaviorSettings[K]) => void;
  installRuntime: (runtimeId: string) => void;
  installMcpTool: (toolId: string) => Promise<void>;

  createRoom: (name: string, emoji: string) => void;
  createTaskRoom: (roomId: string, name: string, emoji: string) => void;
  addMemberToRoom: (roomId: string, memberId: string) => void;
  removeMemberFromRoom: (roomId: string, memberId: string) => void;
  addAgentToRoom: (roomId: string, agentId: string) => void;
  removeAgentFromRoom: (roomId: string, agentId: string) => void;
  addTeamToRoom: (roomId: string, teamId: string) => void;
  setTaskRoomStatus: (taskRoomId: string, status: TaskRoomStatus) => void;

  sendMessage: (taskRoomId: string, content: string, attachments?: string[]) => void;
  sendDirectMessage: (agentId: string, content: string) => void;
  editMessage: (messageId: string, content: string) => void;
  deleteMessage: (messageId: string) => void;
  editDirectMessage: (dmId: string, content: string) => void;
  deleteDirectMessage: (dmId: string) => void;

  createAgent: (
    taskRoomId: string,
    name: string,
    instructions: string,
    color: string,
    avatarEmoji: string,
    model: string,
    runtimeId: string,
    toolIds?: string[]
  ) => void;
  toggleAgentTool: (agentId: string, toolId: string) => void;
  updateAgentConfig: (agentId: string, model: string, runtimeId: string) => void;
  removeAgent: (agentId: string) => void;
  runAgent: (agentId: string) => void;
  stopAgent: (agentId: string) => void;
  stopAllAgents: () => void;

  createAgentTeam: (name: string, agentIds: string[], mode: AgentTeamMode) => void;
  removeAgentTeam: (teamId: string) => void;
  addTeamToTaskRoom: (teamId: string, taskRoomId: string) => void;

  createWorkflow: (taskRoomId: string, name: string, description: string) => void;
  toggleWorkflowStep: (workflowId: string, stepId: string) => void;
  addWorkflowStep: (workflowId: string, name: string) => void;
  markWorkflowDone: (workflowId: string) => void;
  removeWorkflow: (workflowId: string) => void;

  createLoop: (taskRoomId: string, name: string, schedule: string) => void;
  toggleLoopActive: (loopId: string) => void;
  removeLoop: (loopId: string) => void;

  addTodo: (taskRoomId: string, text: string, assigneeId: string | null, dueDate?: string | null) => void;
  toggleTodo: (todoId: string) => void;
};

export const useStore = create<Store>((set, get) => ({
  members: [],
  mcpTools: [],
  rooms: [],
  taskRooms: [],
  messages: [],
  directMessages: [],
  agents: [],
  agentTeams: [],
  agentRuntimes: [],
  agentBehaviorSettings: DEFAULT_AGENT_BEHAVIOR,
  workflows: [],
  loops: [],
  todos: [],

  currentMemberId: "",
  selectedRoomId: null,
  selectedTaskRoomId: null,
  selectedDmAgentId: null,
  activeTab: "chat",
  view: "rooms",
  agentDefaults: DEFAULT_AGENT_DEFAULTS,

  syncError: null,
  actionError: null,
  anthropicKey: "",
  hydrate: async () => {
    const seq = ++hydrateSeq;
    const state = await api.fetchState(syncCursor);
    if (seq < appliedHydrateSeq) return;
    appliedHydrateSeq = seq;
    const before = get();
    const delta = state.sync?.delta ? state.sync.deleted : null;
    const messages = delta
      ? applyDelta(before.messages, state.messages, delta.messages)
      : keepIfSame(before.messages, state.messages);
    const directMessages = delta
      ? applyDelta(before.directMessages, state.directMessages, delta.directMessages)
      : keepIfSame(before.directMessages, state.directMessages);
    syncCursor = state.sync ? { seq: state.sync.seq, scope: state.sync.scope } : null;
    notifyNewAgentMessages(
      { messages: before.messages, directMessages: before.directMessages },
      { messages, directMessages, agents: state.agents }
    );
    hasHydratedOnce = true;
    const anthropic = state.connections.find((c) => c.key === "anthropic");
    set((s) => ({
      members: keepIfSame(s.members, state.members),
      mcpTools: keepIfSame(s.mcpTools, state.mcpTools),
      rooms: keepIfSame(s.rooms, state.rooms),
      taskRooms: keepIfSame(s.taskRooms, state.taskRooms),
      messages,
      directMessages,
      agents: keepIfSame(s.agents, state.agents),
      agentTeams: keepIfSame(s.agentTeams, state.agentTeams),
      agentRuntimes: keepIfSame(s.agentRuntimes, state.agentRuntimes),
      agentBehaviorSettings: keepIfSame(s.agentBehaviorSettings, state.agentBehaviorSettings),
      agentDefaults: keepIfSame(s.agentDefaults, state.agentDefaults),
      workflows: keepIfSame(s.workflows, state.workflows),
      loops: keepIfSame(s.loops, state.loops),
      todos: keepIfSame(s.todos, state.todos),
      anthropicKey: anthropic?.connected ? `on:${anthropic.hint}` : "",
      selectedRoomId: s.selectedRoomId ?? state.rooms[0]?.id ?? null,
      selectedTaskRoomId:
        s.selectedTaskRoomId ?? state.taskRooms.find((t) => t.roomId === state.rooms[0]?.id)?.id ?? null,
    }));
  },

  loadMe: async () => {
    const me = await api.fetchMe();
    set({ currentMemberId: me.id });
  },

  logout: async () => {
    await api.logout().catch(() => {});
    clearToken();
    window.location.reload();
  },

  selectRoom: (roomId) => {
    const firstTaskRoom = get().taskRooms.find((t) => t.roomId === roomId);
    set({ selectedRoomId: roomId, selectedTaskRoomId: firstTaskRoom?.id ?? null, activeTab: "chat", view: "rooms" });
  },
  selectTaskRoom: (taskRoomId) => set({ selectedTaskRoomId: taskRoomId, activeTab: "chat", view: "rooms" }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setView: (view) => set({ view }),
  goToAgentInContext: (agentId) => {
    const agent = get().agents.find((a) => a.id === agentId);
    if (!agent) return;
    get().openTaskRoom(agent.taskRoomId, "agents");
  },
  openTaskRoom: (taskRoomId, tab = "agents") => {
    const taskRoom = get().taskRooms.find((t) => t.id === taskRoomId);
    if (!taskRoom) return;
    set({
      selectedRoomId: taskRoom.roomId,
      selectedTaskRoomId: taskRoom.id,
      activeTab: tab,
      view: "rooms",
    });
  },
  openAgentDm: (agentId) => set({ selectedDmAgentId: agentId, view: "dm" }),

  setAgentDefaults: (defaults) => {
    set({ agentDefaults: defaults });
    api.setAgentDefaults(defaults).then(refresh, fail);
  },
  setAgentBehaviorSetting: (key, value) => {
    set((s) => ({ agentBehaviorSettings: { ...s.agentBehaviorSettings, [key]: value } }));
    api.setAgentBehaviorSetting(key, value).then(refresh, fail);
  },
  installRuntime: (runtimeId) => {
    // No optimistic update here — unlike most actions, this one has a real chance of
    // failing (the CLI genuinely isn't installed), so wait for the actual result.
    api.installRuntime(runtimeId).then(refresh, fail);
  },
  installMcpTool: async (toolId) => {
    try {
      await api.installMcpTool(toolId);
      await get().hydrate();
    } catch (err) {
      showError(err);
    }
  },

  createRoom: (name, emoji) => {
    api.createRoom(name, emoji).then((room) => {
      set({ selectedRoomId: room.id, selectedTaskRoomId: null });
      refresh();
    }, fail);
  },

  createTaskRoom: (roomId, name, emoji) => {
    api.createTaskRoom(roomId, name, emoji).then((taskRoom) => {
      set({ selectedTaskRoomId: taskRoom.id, activeTab: "chat" });
      refresh();
    }, fail);
  },

  addMemberToRoom: (roomId, memberId) => {
    api.addMemberToRoom(roomId, memberId).then(refresh, fail);
  },

  removeMemberFromRoom: (roomId, memberId) => {
    api
      .removeMemberFromRoom(roomId, memberId)
      .then(refresh, fail);
  },

  addAgentToRoom: (roomId, agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, roomId } : a)) }));
    api.addAgentToRoom(roomId, agentId).then(refresh, fail);
  },

  removeAgentFromRoom: (roomId, agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, roomId: null } : a)) }));
    api.removeAgentFromRoom(roomId, agentId).then(refresh, fail);
  },

  addTeamToRoom: (roomId, teamId) => {
    api.addTeamToRoom(roomId, teamId).then(refresh, fail);
  },

  setTaskRoomStatus: (taskRoomId, status) => {
    set((s) => ({ taskRooms: s.taskRooms.map((t) => (t.id === taskRoomId ? { ...t, status } : t)) }));
    api.setTaskRoomStatus(taskRoomId, status).then(refresh, fail);
  },

  sendMessage: (taskRoomId, content, attachments = []) => {
    const optimistic: ChatMessage = {
      id: tempId("msg"),
      taskRoomId,
      authorType: "member",
      authorId: get().currentMemberId,
      content,
      attachments,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    set((s) => ({ messages: [...s.messages, optimistic] }));
    api
      .sendMessage(taskRoomId, content, attachments)
      .then((saved) => {
        set((s) => ({ messages: settle(s.messages, optimistic.id, saved) }));
        refresh();
      }, (err) => {
        set((s) => ({ messages: s.messages.filter((m) => m.id !== optimistic.id) }));
        showError(err);
      });
  },

  sendDirectMessage: (agentId, content) => {
    const optimistic: DirectMessage = {
      id: tempId("dm"),
      agentId,
      authorType: "member",
      memberId: get().currentMemberId,
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    set((s) => ({ directMessages: [...s.directMessages, optimistic] }));
    api
      .sendDirectMessage(agentId, content)
      .then((saved) => {
        set((s) => ({ directMessages: settle(s.directMessages, optimistic.id, saved) }));
        refresh();
      }, (err) => {
        set((s) => ({ directMessages: s.directMessages.filter((m) => m.id !== optimistic.id) }));
        showError(err);
      });
  },

  editMessage: (messageId, content) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, content, editedAt: new Date().toISOString() } : m
      ),
    }));
    api.editMessage(messageId, content).then(refresh, fail);
  },

  deleteMessage: (messageId) => {
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    api.deleteMessage(messageId).then(refresh, fail);
  },

  editDirectMessage: (dmId, content) => {
    set((s) => ({
      directMessages: s.directMessages.map((m) =>
        m.id === dmId ? { ...m, content, editedAt: new Date().toISOString() } : m
      ),
    }));
    api.editDirectMessage(dmId, content).then(refresh, fail);
  },

  deleteDirectMessage: (dmId) => {
    set((s) => ({ directMessages: s.directMessages.filter((m) => m.id !== dmId) }));
    api.deleteDirectMessage(dmId).then(refresh, fail);
  },

  createAgent: (taskRoomId, name, instructions, color, avatarEmoji, model, runtimeId, toolIds) => {
    api
      .createAgent({ taskRoomId, name, instructions, color, avatarEmoji, model, runtimeId, toolIds })
      .then(refresh, fail);
  },

  toggleAgentTool: (agentId, toolId) => {
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== agentId) return a;
        const hasGrant = a.grants.some((g) => g.toolId === toolId);
        return {
          ...a,
          grants: hasGrant
            ? a.grants.filter((g) => g.toolId !== toolId)
            : [...a.grants, { toolId, grantedById: get().currentMemberId, grantedAt: new Date().toISOString() }],
        };
      }),
    }));
    api.toggleAgentTool(agentId, toolId).then(refresh, fail);
  },

  updateAgentConfig: (agentId, model, runtimeId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, model, runtimeId } : a)) }));
    api.updateAgentConfig(agentId, { model, runtimeId }).then(refresh, fail);
  },

  removeAgent: (agentId) => {
    set((s) => ({ agents: s.agents.filter((a) => a.id !== agentId) }));
    api.removeAgent(agentId).then(refresh, fail);
  },

  runAgent: (agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, status: "running" } : a)) }));
    api.runAgent(agentId).then(refresh, fail);
  },

  stopAgent: (agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, status: "idle" } : a)) }));
    api.stopAgent(agentId).then(refresh, fail);
  },

  stopAllAgents: () => {
    set((s) => ({ agents: s.agents.map((a) => (a.status === "running" ? { ...a, status: "idle" } : a)) }));
    api.stopAllAgents().then(refresh, fail);
  },

  createWorkflow: (taskRoomId, name, description) => {
    api.createWorkflow(taskRoomId, name, description).then(refresh, fail);
  },

  toggleWorkflowStep: (workflowId, stepId) => {
    api.toggleWorkflowStep(workflowId, stepId).then(refresh, fail);
  },

  addWorkflowStep: (workflowId, name) => {
    api.addWorkflowStep(workflowId, name).then(refresh, fail);
  },

  markWorkflowDone: (workflowId) => {
    set((s) => ({ workflows: s.workflows.map((w) => (w.id === workflowId ? { ...w, status: "done" } : w)) }));
    api.markWorkflowDone(workflowId).then(refresh, fail);
  },

  removeWorkflow: (workflowId) => {
    set((s) => ({ workflows: s.workflows.filter((w) => w.id !== workflowId) }));
    api.removeWorkflow(workflowId).then(refresh, fail);
  },

  createLoop: (taskRoomId, name, schedule) => {
    api.createLoop(taskRoomId, name, schedule).then(refresh, fail);
  },

  toggleLoopActive: (loopId) => {
    set((s) => ({ loops: s.loops.map((l) => (l.id === loopId ? { ...l, active: !l.active } : l)) }));
    api.toggleLoopActive(loopId).then(refresh, fail);
  },

  removeLoop: (loopId) => {
    set((s) => ({ loops: s.loops.filter((l) => l.id !== loopId) }));
    api.removeLoop(loopId).then(refresh, fail);
  },

  addTodo: (taskRoomId, text, assigneeId, dueDate = null) => {
    api.addTodo(taskRoomId, text, assigneeId, dueDate).then(refresh, fail);
  },

  toggleTodo: (todoId) => {
    set((s) => ({ todos: s.todos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t)) }));
    api.toggleTodo(todoId).then(refresh, fail);
  },

  createAgentTeam: (name, agentIds, mode) => {
    api.createAgentTeam(name, agentIds, mode).then(refresh, fail);
  },

  removeAgentTeam: (teamId) => {
    set((s) => ({ agentTeams: s.agentTeams.filter((t) => t.id !== teamId) }));
    api.removeAgentTeam(teamId).then(refresh, fail);
  },

  addTeamToTaskRoom: (teamId, taskRoomId) => {
    api.addTeamToTaskRoom(teamId, taskRoomId).then(() => {
      get().openTaskRoom(taskRoomId, "agents");
      refresh();
    }, fail);
  },
}));
