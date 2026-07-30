import { create } from "zustand";
import * as api from "./api";
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

const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  model: "Claude Sonnet 5",
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

  createRoom: (name: string, emoji: string) => void;
  createTaskRoom: (roomId: string, name: string, emoji: string) => void;
  addMemberToRoom: (roomId: string, memberId: string) => void;
  removeMemberFromRoom: (roomId: string, memberId: string) => void;
  setTaskRoomStatus: (taskRoomId: string, status: TaskRoomStatus) => void;

  sendMessage: (taskRoomId: string, content: string) => void;
  sendDirectMessage: (agentId: string, content: string) => void;

  createAgent: (
    taskRoomId: string,
    name: string,
    instructions: string,
    color: string,
    avatarEmoji: string,
    model: string,
    runtimeId: string
  ) => void;
  toggleAgentTool: (agentId: string, toolId: string) => void;
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
    const state = await api.fetchState();
    set((s) => ({
      members: state.members,
      mcpTools: state.mcpTools,
      rooms: state.rooms,
      taskRooms: state.taskRooms,
      messages: state.messages,
      directMessages: state.directMessages,
      agents: state.agents,
      agentTeams: state.agentTeams,
      agentRuntimes: state.agentRuntimes,
      agentBehaviorSettings: state.agentBehaviorSettings,
      agentDefaults: state.agentDefaults,
      workflows: state.workflows,
      loops: state.loops,
      todos: state.todos,
      currentMemberId: state.currentMemberId,
      selectedRoomId: s.selectedRoomId ?? state.rooms[0]?.id ?? null,
      selectedTaskRoomId:
        s.selectedTaskRoomId ?? state.taskRooms.find((t) => t.roomId === state.rooms[0]?.id)?.id ?? null,
    }));
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
    set((s) => ({
      agentRuntimes: s.agentRuntimes.map((r) => (r.id === runtimeId ? { ...r, status: "ready" } : r)),
    }));
    api.installRuntime(runtimeId).then(() => get().hydrate());
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
    api.removeMemberFromRoom(roomId, memberId).then(() => get().hydrate());
  },

  setTaskRoomStatus: (taskRoomId, status) => {
    set((s) => ({ taskRooms: s.taskRooms.map((t) => (t.id === taskRoomId ? { ...t, status } : t)) }));
    api.setTaskRoomStatus(taskRoomId, status).then(() => get().hydrate());
  },

  sendMessage: (taskRoomId, content) => {
    const optimistic: ChatMessage = {
      id: tempId("msg"),
      taskRoomId,
      authorType: "member",
      authorId: get().currentMemberId,
      content,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, optimistic] }));
    api.sendMessage(taskRoomId, content).then(() => get().hydrate());
  },

  sendDirectMessage: (agentId, content) => {
    const optimistic: DirectMessage = {
      id: tempId("dm"),
      agentId,
      authorType: "member",
      content,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ directMessages: [...s.directMessages, optimistic] }));
    api.sendDirectMessage(agentId, content).then(() => get().hydrate());
  },

  createAgent: (taskRoomId, name, instructions, color, avatarEmoji, model, runtimeId) => {
    api
      .createAgent({ taskRoomId, name, instructions, color, avatarEmoji, model, runtimeId })
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
