export const AGENT_MODEL_OPTIONS = [
  "Claude Opus 5.5",
  "Claude Sonnet 5.5",
  "Claude Haiku 5.5",
  "Claude Opus 4.8",
  "Claude Sonnet 5",
  "Claude Haiku 4.5",
] as const;

/** Whose model list a runtime picks from (see ModelInput). */
export function modelProvider(runtimeId: string): "anthropic" | "openrouter" | "codex" {
  return runtimeId === "runtime-openrouter" ? "openrouter" : runtimeId === "runtime-codex" ? "codex" : "anthropic";
}

export const AGENT_EMOJI_OPTIONS = ["🤖", "🐝", "🦊", "👾", "🎯", "🧠", "⚡", "🔎", "✍️", "🩹", "🎨", "💻"];

export const BASH_ACCESS_TOOL_ID = "bash-access";
/** Grants that run real code on this machine — confirmed inline first
 * (AgentsPanel's grant chips, CreateAgentModal's role presets). */
export const GRANT_WARNINGS: Record<string, (agentName: string) => string> = {
  "mcp-preview": (name) =>
    `This lets ${name} run a real npm install + dev server on this machine, confined to this room's project folder. It only takes effect if the server operator has also enabled agent tool access. Continue?`,
  [BASH_ACCESS_TOOL_ID]: (name) =>
    `This lets ${name} run real shell commands and edit files on this machine, confined to its own workspace folder. It only takes effect if the server operator has also enabled agent tool access. Continue?`,
};

/** Starting points for an agency-style team. Instructions' first line doubles
 * as the role other agents see in their teammate list (see claudeAgent.ts). */
export const AGENT_ROLE_PRESETS = [
  {
    label: "Project Manager",
    emoji: "🎯",
    toolIds: ["mcp-filesystem"],
    instructions:
      "Project manager: turns client briefs into plans and keeps the team shipping.\nBreak the brief into concrete tasks, add them as todos assigned to the right teammates, and hand work off by @mentioning them with clear, specific asks. Track progress, unblock people, keep a short project plan in the project folder (plan.md), and review deliverables against the brief before calling anything done.",
  },
  {
    label: "Researcher",
    emoji: "🔎",
    toolIds: ["web-research", "mcp-filesystem"],
    instructions:
      "Researcher: market, competitor, audience and technical research.\nUse web research, cite sources with links, separate facts from assumptions, and write findings as a markdown report in the project folder (research/). Summarize the key takeaways in chat.",
  },
  {
    label: "UX/UI Designer",
    emoji: "🎨",
    toolIds: ["mcp-filesystem", "mcp-browser"],
    instructions:
      "UX/UI designer: user flows, wireframes, visual design and UI mockups.\nWork from the brief and research. Produce HTML/CSS mockups or SVGs in the project folder (design/), generate visuals when useful, check your work in the browser, and attach the key screens. Explain design decisions briefly.",
  },
  {
    label: "Developer",
    emoji: "💻",
    toolIds: ["mcp-filesystem", "mcp-preview"],
    instructions:
      "Software developer: builds the product in the Room's project folder.\nWrite clean, working code, run it in the live preview to check it, and keep a README up to date. Implement designs faithfully and ask the project manager when requirements are unclear.",
  },
  {
    label: "Copywriter",
    emoji: "✍️",
    toolIds: ["mcp-filesystem"],
    instructions:
      "Copywriter: headlines, ads, landing pages, emails and social posts.\nWrite on-brand copy in several variants with a recommended pick and a one-line rationale. Save longer copy to the project folder (copy/).",
  },
] as const;

export const AGENT_COLOR_OPTIONS = ["#5b5cff", "#00b389", "#ffb020", "#ff6b6b", "#8384ff"];
