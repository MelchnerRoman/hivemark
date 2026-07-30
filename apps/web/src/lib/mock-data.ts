import type {
  Agent,
  AgentRuntime,
  AgentTeam,
  ChatMessage,
  DirectMessage,
  Loop,
  McpTool,
  Member,
  Room,
  TaskRoom,
  TodoItem,
  Workflow,
} from "./types";

export const agentRuntimes: AgentRuntime[] = [
  {
    id: "runtime-hivemark",
    name: "Hivemark Agent",
    icon: "🐝",
    status: "ready",
    description: "Runs natively inside Hivemark. No install needed.",
  },
  {
    id: "runtime-claude-code",
    name: "Claude Code",
    icon: "✳️",
    status: "ready",
    description: "Hivemark talks to Claude Code directly.",
  },
  {
    id: "runtime-codex",
    name: "Codex",
    icon: "⌨️",
    status: "cli_needed",
    description: "Hivemark talks to the Codex CLI through an ACP adapter.",
    installHint: "npm install -g @agentclientprotocol/codex-acp",
    setupUrl: "https://github.com/agentclientprotocol",
  },
  {
    id: "runtime-goose",
    name: "Goose",
    icon: "🦢",
    status: "cli_needed",
    description: "Hivemark talks to Goose through the Goose CLI.",
    setupUrl: "https://block.github.io/goose/",
  },
];

export const members: Member[] = [
  { id: "m-roman", name: "Roman Melchner", initials: "RM", color: "#5b5cff", role: "owner" },
  { id: "m-jana", name: "Jana Voigt", initials: "JV", color: "#00b389", role: "member" },
  { id: "m-tom", name: "Tom Reiber", initials: "TR", color: "#ffb020", role: "member" },
  { id: "m-lea", name: "Lea Sander", initials: "LS", color: "#ff6b6b", role: "member" },
];

export const mcpToolCatalog: McpTool[] = [
  { id: "mcp-github", name: "GitHub", description: "Read/write repos, PRs, issues", icon: "code" },
  { id: "mcp-linear", name: "Linear", description: "Create and update tickets", icon: "list" },
  { id: "mcp-postgres", name: "Postgres", description: "Query the staging database", icon: "database" },
  { id: "mcp-browser", name: "Browser", description: "Navigate and read web pages", icon: "globe" },
  { id: "mcp-slack", name: "Slack Export", description: "Read message history for context", icon: "message" },
];

export const rooms: Room[] = [
  {
    id: "room-platform",
    name: "Platform Team",
    emoji: "🧩",
    memberIds: ["m-roman", "m-jana", "m-tom"],
    taskRoomIds: ["tr-onboarding", "tr-billing"],
  },
  {
    id: "room-launch",
    name: "Q3 Launch",
    emoji: "🚀",
    memberIds: ["m-roman", "m-lea", "m-jana"],
    taskRoomIds: ["tr-landing", "tr-pricing"],
  },
];

export const taskRooms: TaskRoom[] = [
  {
    id: "tr-onboarding",
    roomId: "room-platform",
    name: "Rework onboarding flow",
    emoji: "🛬",
    status: "in_progress",
    memberIds: ["m-roman", "m-jana"],
  },
  {
    id: "tr-billing",
    roomId: "room-platform",
    name: "Fix billing webhook retries",
    emoji: "💳",
    status: "open",
    memberIds: ["m-tom", "m-roman"],
  },
  {
    id: "tr-landing",
    roomId: "room-launch",
    name: "New landing page",
    emoji: "🖼️",
    status: "in_progress",
    memberIds: ["m-lea", "m-roman"],
  },
  {
    id: "tr-pricing",
    roomId: "room-launch",
    name: "Pricing page copy pass",
    emoji: "🏷️",
    status: "done",
    memberIds: ["m-jana", "m-lea"],
  },
];

export const chatMessages: ChatMessage[] = [
  {
    id: "msg-1",
    taskRoomId: "tr-onboarding",
    authorType: "member",
    authorId: "m-jana",
    content: "Drafted the new 3-step onboarding. Kicking off the agent to audit drop-off events.",
    createdAt: "2026-07-29T09:12:00Z",
  },
  {
    id: "msg-2",
    taskRoomId: "tr-onboarding",
    authorType: "agent",
    authorId: "agent-onboarding-auditor",
    content: "Pulled the last 14 days of onboarding events via Postgres. Step 2 (workspace naming) has a 38% drop-off — highest of all steps.",
    createdAt: "2026-07-29T09:15:00Z",
  },
  {
    id: "msg-3",
    taskRoomId: "tr-onboarding",
    authorType: "member",
    authorId: "m-roman",
    content: "Good catch. Let's default the workspace name instead of requiring input.",
    createdAt: "2026-07-29T09:20:00Z",
  },
];

export const directMessages: DirectMessage[] = [
  {
    id: "dm-1",
    agentId: "agent-onboarding-auditor",
    authorType: "member",
    content: "Can you re-check the drop-off numbers for the last 7 days specifically?",
    createdAt: "2026-07-29T16:40:00Z",
  },
  {
    id: "dm-2",
    agentId: "agent-onboarding-auditor",
    authorType: "agent",
    content: "On it — pulling the last 7 days from Postgres now. Step 2 is still the biggest drop-off point, at 34%.",
    createdAt: "2026-07-29T16:41:00Z",
  },
];

export const agents: Agent[] = [
  {
    id: "agent-onboarding-auditor",
    taskRoomId: "tr-onboarding",
    name: "Onboarding Auditor",
    color: "#5b5cff",
    avatarEmoji: "🔎",
    model: "Claude Sonnet 5",
    runtimeId: "runtime-hivemark",
    instructions: "Analyze onboarding funnel drop-off using Postgres data and summarize findings in chat.",
    status: "idle",
    createdById: "m-jana",
    grants: [{ toolId: "mcp-postgres", grantedById: "m-jana", grantedAt: "2026-07-28T18:00:00Z" }],
  },
  {
    id: "agent-webhook-medic",
    taskRoomId: "tr-billing",
    name: "Webhook Medic",
    color: "#ff6b6b",
    avatarEmoji: "🩹",
    model: "Claude Opus 4.8",
    runtimeId: "runtime-claude-code",
    instructions: "Watch billing webhook retries and open a GitHub issue when the failure rate spikes.",
    status: "running",
    createdById: "m-tom",
    grants: [{ toolId: "mcp-github", grantedById: "m-tom", grantedAt: "2026-07-29T09:00:00Z" }],
  },
  {
    id: "agent-copy-writer",
    taskRoomId: "tr-landing",
    name: "Copy Writer",
    color: "#00b389",
    avatarEmoji: "✍️",
    model: "Claude Sonnet 5",
    runtimeId: "runtime-hivemark",
    instructions: "Draft landing page copy variants for the Q3 launch hero section.",
    status: "idle",
    createdById: "m-lea",
    grants: [],
  },
];

export const agentTeams: AgentTeam[] = [
  {
    id: "team-launch-crew",
    name: "Launch Crew",
    mode: "auto",
    agentIds: ["agent-onboarding-auditor", "agent-webhook-medic", "agent-copy-writer"],
  },
];

export const workflows: Workflow[] = [
  {
    id: "wf-onboarding-revamp",
    taskRoomId: "tr-onboarding",
    name: "Ship onboarding revamp",
    description: "End-to-end rollout of the reworked onboarding flow.",
    status: "running",
    steps: [
      { id: "s1", name: "Audit drop-off funnel", done: true },
      { id: "s2", name: "Design 3-step flow", done: true },
      { id: "s3", name: "Implement + default workspace name", done: false },
      { id: "s4", name: "Ship behind flag to 10%", done: false },
    ],
  },
];

export const loops: Loop[] = [
  {
    id: "loop-funnel-check",
    taskRoomId: "tr-onboarding",
    name: "Daily funnel health check",
    schedule: "Every day at 08:00",
    active: true,
    lastRun: "2026-07-30T08:00:00Z",
    nextRun: "2026-07-31T08:00:00Z",
  },
];

export const todos: TodoItem[] = [
  {
    id: "td-1",
    taskRoomId: "tr-onboarding",
    text: "Default workspace name field",
    done: false,
    assigneeId: "m-roman",
    dueDate: "2026-08-01",
  },
  {
    id: "td-2",
    taskRoomId: "tr-onboarding",
    text: "Update onboarding analytics events",
    done: false,
    assigneeId: "m-jana",
    dueDate: null,
  },
  {
    id: "td-3",
    taskRoomId: "tr-onboarding",
    text: "Write rollout announcement",
    done: true,
    assigneeId: "m-jana",
    dueDate: "2026-07-25",
  },
  {
    id: "td-4",
    taskRoomId: "tr-onboarding",
    text: "QA the redirect after signup",
    done: false,
    assigneeId: null,
    dueDate: "2026-08-05",
  },
];
