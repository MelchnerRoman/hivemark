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
function keepIfSame<T>(prev: T, next: T): T {
  return sameJSON(prev, next) ? prev : next;
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

  hydrate: async () => {
    const seq = ++hydrateSeq;
    const state = await api.fetchState();
    if (seq < appliedHydrateSeq) return;
    appliedHydrateSeq = seq;
    const before = get();
    notifyNewAgentMessages(
      { messages: before.messages, directMessages: before.directMessages },
      { messages: state.messages, directMessages: state.directMessages, agents: state.agents }
    );
    hasHydratedOnce = true;
    set((s) => ({
      members: keepIfSame(s.members, state.members),
      mcpTools: keepIfSame(s.mcpTools, state.mcpTools),
      rooms: keepIfSame(s.rooms, state.rooms),
      taskRooms: keepIfSame(s.taskRooms, state.taskRooms),
      messages: keepIfSame(s.messages, state.messages),
      directMessages: keepIfSame(s.directMessages, state.directMessages),
      agents: keepIfSame(s.agents, state.agents),
      agentTeams: keepIfSame(s.agentTeams, state.agentTeams),
      agentRuntimes: keepIfSame(s.agentRuntimes, state.agentRuntimes),
      agentBehaviorSettings: keepIfSame(s.agentBehaviorSettings, state.agentBehaviorSettings),
      agentDefaults: keepIfSame(s.agentDefaults, state.agentDefaults),
      workflows: keepIfSame(s.workflows, state.workflows),
      loops: keepIfSame(s.loops, state.loops),
      todos: keepIfSame(s.todos, state.todos),
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
    api.setAgentDefaults(defaults).then(() => get().hydrate());
  },
  setAgentBehaviorSetting: (key, value) => {
    set((s) => ({ agentBehaviorSettings: { ...s.agentBehaviorSettings, [key]: value } }));
    api.setAgentBehaviorSetting(key, value).then(() => get().hydrate());
  },
  installRuntime: (runtimeId) => {
    // No optimistic update here — unlike most actions, this one has a real chance of
    // failing (the CLI genuinely isn't installed), so wait for the actual result.
    api
      .installRuntime(runtimeId)
      .then(() => get().hydrate())
      .catch((err) => alert(err instanceof Error ? err.message : String(err)));
  },
  installMcpTool: async (toolId) => {
    try {
      await api.installMcpTool(toolId);
      await get().hydrate();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  },

  createRoom: (name, emoji) => {
    api.createRoom(name, emoji).then((room) => {
      set({ selectedRoomId: room.id, selectedTaskRoomId: null });
      get().hydrate();
    });
  },

  createTaskRoom: (roomId, name, emoji) => {
    api.createTaskRoom(roomId, name, emoji).then((taskRoom) => {
      set({ selectedTaskRoomId: taskRoom.id, activeTab: "chat" });
      get().hydrate();
    });
  },

  addMemberToRoom: (roomId, memberId) => {
    api.addMemberToRoom(roomId, memberId).then(() => get().hydrate());
  },

  removeMemberFromRoom: (roomId, memberId) => {
    api
      .removeMemberFromRoom(roomId, memberId)
      .then(() => get().hydrate())
      .catch((err) => alert(err instanceof Error ? err.message : String(err)));
  },

  addAgentToRoom: (roomId, agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, roomId } : a)) }));
    api.addAgentToRoom(roomId, agentId).then(() => get().hydrate());
  },

  removeAgentFromRoom: (roomId, agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, roomId: null } : a)) }));
    api.removeAgentFromRoom(roomId, agentId).then(() => get().hydrate());
  },

  addTeamToRoom: (roomId, teamId) => {
    api.addTeamToRoom(roomId, teamId).then(() => get().hydrate());
  },

  setTaskRoomStatus: (taskRoomId, status) => {
    set((s) => ({ taskRooms: s.taskRooms.map((t) => (t.id === taskRoomId ? { ...t, status } : t)) }));
    api.setTaskRoomStatus(taskRoomId, status).then(() => get().hydrate());
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
      .then(() => get().hydrate())
      .catch((err) => {
        set((s) => ({ messages: s.messages.filter((m) => m.id !== optimistic.id) }));
        alert(err instanceof Error ? err.message : String(err));
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
      .then(() => get().hydrate())
      .catch((err) => {
        set((s) => ({ directMessages: s.directMessages.filter((m) => m.id !== optimistic.id) }));
        alert(err instanceof Error ? err.message : String(err));
      });
  },

  editMessage: (messageId, content) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, content, editedAt: new Date().toISOString() } : m
      ),
    }));
    api.editMessage(messageId, content).then(() => get().hydrate()).catch((err) => alert(err instanceof Error ? err.message : String(err)));
  },

  deleteMessage: (messageId) => {
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    api.deleteMessage(messageId).then(() => get().hydrate()).catch((err) => alert(err instanceof Error ? err.message : String(err)));
  },

  editDirectMessage: (dmId, content) => {
    set((s) => ({
      directMessages: s.directMessages.map((m) =>
        m.id === dmId ? { ...m, content, editedAt: new Date().toISOString() } : m
      ),
    }));
    api.editDirectMessage(dmId, content).then(() => get().hydrate()).catch((err) => alert(err instanceof Error ? err.message : String(err)));
  },

  deleteDirectMessage: (dmId) => {
    set((s) => ({ directMessages: s.directMessages.filter((m) => m.id !== dmId) }));
    api.deleteDirectMessage(dmId).then(() => get().hydrate()).catch((err) => alert(err instanceof Error ? err.message : String(err)));
  },

  createAgent: (taskRoomId, name, instructions, color, avatarEmoji, model, runtimeId, toolIds) => {
    api
      .createAgent({ taskRoomId, name, instructions, color, avatarEmoji, model, runtimeId, toolIds })
      .then(() => get().hydrate());
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
    api.toggleAgentTool(agentId, toolId).then(() => get().hydrate());
  },

  updateAgentConfig: (agentId, model, runtimeId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, model, runtimeId } : a)) }));
    api.updateAgentConfig(agentId, { model, runtimeId }).then(() => get().hydrate());
  },

  removeAgent: (agentId) => {
    set((s) => ({ agents: s.agents.filter((a) => a.id !== agentId) }));
    api.removeAgent(agentId).then(() => get().hydrate());
  },

  runAgent: (agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, status: "running" } : a)) }));
    api.runAgent(agentId).then(() => get().hydrate());
  },

  stopAgent: (agentId) => {
    set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, status: "idle" } : a)) }));
    api.stopAgent(agentId).then(() => get().hydrate());
  },

  stopAllAgents: () => {
    set((s) => ({ agents: s.agents.map((a) => (a.status === "running" ? { ...a, status: "idle" } : a)) }));
    api.stopAllAgents().then(() => get().hydrate());
  },

  createWorkflow: (taskRoomId, name, description) => {
    api.createWorkflow(taskRoomId, name, description).then(() => get().hydrate());
  },

  toggleWorkflowStep: (workflowId, stepId) => {
    api.toggleWorkflowStep(workflowId, stepId).then(() => get().hydrate());
  },

  addWorkflowStep: (workflowId, name) => {
    api.addWorkflowStep(workflowId, name).then(() => get().hydrate());
  },

  markWorkflowDone: (workflowId) => {
    set((s) => ({ workflows: s.workflows.map((w) => (w.id === workflowId ? { ...w, status: "done" } : w)) }));
    api.markWorkflowDone(workflowId).then(() => get().hydrate());
  },

  removeWorkflow: (workflowId) => {
    set((s) => ({ workflows: s.workflows.filter((w) => w.id !== workflowId) }));
    api.removeWorkflow(workflowId).then(() => get().hydrate());
  },

  createLoop: (taskRoomId, name, schedule) => {
    api.createLoop(taskRoomId, name, schedule).then(() => get().hydrate());
  },

  toggleLoopActive: (loopId) => {
    set((s) => ({ loops: s.loops.map((l) => (l.id === loopId ? { ...l, active: !l.active } : l)) }));
    api.toggleLoopActive(loopId).then(() => get().hydrate());
  },

  removeLoop: (loopId) => {
    set((s) => ({ loops: s.loops.filter((l) => l.id !== loopId) }));
    api.removeLoop(loopId).then(() => get().hydrate());
  },

  addTodo: (taskRoomId, text, assigneeId, dueDate = null) => {
    api.addTodo(taskRoomId, text, assigneeId, dueDate).then(() => get().hydrate());
  },

  toggleTodo: (todoId) => {
    set((s) => ({ todos: s.todos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t)) }));
    api.toggleTodo(todoId).then(() => get().hydrate());
  },

  createAgentTeam: (name, agentIds, mode) => {
    api.createAgentTeam(name, agentIds, mode).then(() => get().hydrate());
  },

  removeAgentTeam: (teamId) => {
    set((s) => ({ agentTeams: s.agentTeams.filter((t) => t.id !== teamId) }));
    api.removeAgentTeam(teamId).then(() => get().hydrate());
  },

  addTeamToTaskRoom: (teamId, taskRoomId) => {
    api.addTeamToTaskRoom(teamId, taskRoomId).then(() => {
      get().openTaskRoom(taskRoomId, "agents");
      get().hydrate();
    });
  },
}));
