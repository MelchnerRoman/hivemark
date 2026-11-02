"use client";

import { modelProvider } from "@/lib/agent-constants";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { AGENT_STATUS_TONE } from "@/lib/display";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CreateAgentModal } from "@/components/modals/CreateAgentModal";
import { RuntimeSelect } from "@/components/agents/RuntimeSelect";
import { ModelInput } from "@/components/agents/ModelInput";
import type { Agent } from "@/lib/types";

const BASH_ACCESS_TOOL_ID = "bash-access";
const BASH_CAPABLE_RUNTIMES = ["runtime-claude-code", "runtime-codex"];

export function AgentsPanel({ taskRoomId }: { taskRoomId: string }) {
  const agents = useStore(useShallow((s) => s.agents));
  const taskRooms = useStore((s) => s.taskRooms);
  const mcpTools = useStore((s) => s.mcpTools);
  const members = useStore((s) => s.members);
  const toggleAgentTool = useStore((s) => s.toggleAgentTool);
  const removeAgent = useStore((s) => s.removeAgent);
  const runAgent = useStore((s) => s.runAgent);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-foreground-muted">
          Every agent is available here — @mention one in chat to bring it in.
        </p>
        <Button onClick={() => setCreateOpen(true)}>New agent</Button>
      </div>

      <div className="space-y-4">
        {agents.map((agent) => {
          const creator = members.find((m) => m.id === agent.createdById);
          const isHome = agent.taskRoomId === taskRoomId;
          const homeTaskRoom = taskRooms.find((t) => t.id === agent.taskRoomId);
          return (
            <div key={agent.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Avatar label={agent.avatarEmoji} color={agent.color} size={32} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-sm font-semibold">{agent.name}</h3>
                      <Badge tone={AGENT_STATUS_TONE[agent.status]}>{agent.status}</Badge>
                    </div>
                    <p className="text-xs text-foreground-muted">
                      {agent.model} · Created by {creator?.name ?? "someone"}
                      {!isHome && homeTaskRoom && ` · Home: ${homeTaskRoom.emoji} ${homeTaskRoom.name}`}
                      {" · "}
                      <button
                        onClick={() => setEditingAgentId(editingAgentId === agent.id ? null : agent.id)}
                        className="text-brand hover:underline"
                      >
                        {editingAgentId === agent.id ? "Cancel" : "Edit runtime/model"}
                      </button>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    disabled={agent.status === "running"}
                    onClick={() => runAgent(agent.id)}
                    className="text-xs"
                  >
                    {agent.status === "running" ? "Running…" : "Run agent"}
                  </Button>
                  {isHome && (
                    <button
                      onClick={() => removeAgent(agent.id)}
                      className="text-xs text-foreground-muted hover:text-danger"
                      title="Delete this agent"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {editingAgentId === agent.id && (
                <AgentConfigEditor agent={agent} onDone={() => setEditingAgentId(null)} />
              )}

              {agent.instructions && (
                <p className="mt-3 text-sm text-foreground-muted">{agent.instructions}</p>
              )}

              <div className="mt-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  MCP tool access
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {mcpTools.map((tool) => {
                    const granted = agent.grants.some((g) => g.toolId === tool.id);
                    const key = `${agent.id}:${tool.id}`;
                    const isExpanded = expandedTool === key;
                    const grantTool = () => {
                      if (
                        granted ||
                        tool.id !== "mcp-preview" ||
                        window.confirm(
                          `This lets ${agent.name} run a real npm install + dev server on this machine, confined to this room's project folder. It only takes effect if the server operator has also enabled agent tool access. Continue?`
                        )
                      ) {
                        toggleAgentTool(agent.id, tool.id);
                      }
                      setExpandedTool(null);
                    };
                    return (
                      <div key={tool.id} className="relative">
                        <div
                          className={`flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-xs font-medium transition-colors ${
                            granted
                              ? "border-accent/40 bg-accent-soft text-accent"
                              : "border-border text-foreground-muted hover:bg-surface-raised"
                          }`}
                        >
                          <button onClick={grantTool} title={tool.description}>
                            {granted ? "✓ " : "+ "}
                            {tool.name}
                          </button>
                          {!granted && (
                            <button
                              type="button"
                              onClick={() => setExpandedTool(isExpanded ? null : key)}
                              aria-label={`About ${tool.name}`}
                              aria-expanded={isExpanded}
                              className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none text-foreground-muted hover:bg-surface-raised hover:text-brand"
                            >
                              ⓘ
                            </button>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-border bg-surface p-2.5 text-xs text-foreground-muted shadow-xl">
                            <p className="mb-2">{tool.description}</p>
                            <Button variant="secondary" className="w-full text-xs" onClick={grantTool}>
                              Grant access
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {BASH_CAPABLE_RUNTIMES.includes(agent.runtimeId) && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                    Shell &amp; file access
                  </p>
                  {(() => {
                    const granted = agent.grants.some((g) => g.toolId === BASH_ACCESS_TOOL_ID);
                    return (
                      <button
                        onClick={() => {
                          if (
                            granted ||
                            window.confirm(
                              `This lets ${agent.name} run real shell commands and edit files on this machine, confined to its own workspace folder. It only takes effect if the server operator has also enabled agent tool access. Continue?`
                            )
                          ) {
                            toggleAgentTool(agent.id, BASH_ACCESS_TOOL_ID);
                          }
                        }}
                        className={`rounded-full border py-1 px-2.5 text-xs font-medium transition-colors ${
                          granted
                            ? "border-danger/40 bg-danger-soft text-danger"
                            : "border-border text-foreground-muted hover:bg-surface-raised"
                        }`}
                      >
                        {granted ? "✓ Bash access granted" : "+ Grant Bash access"}
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}

        {agents.length === 0 && (
          <p className="pt-10 text-center text-sm text-foreground-muted">
            No agents yet. Create one and grant it MCP tools to get started.
          </p>
        )}
      </div>

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} taskRoomId={taskRoomId} />
    </div>
  );
}

function AgentConfigEditor({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const updateAgentConfig = useStore((s) => s.updateAgentConfig);
  const [runtimeId, setRuntimeId] = useState(agent.runtimeId);
  const [model, setModel] = useState(agent.model);

  function handleRuntimeChange(nextRuntimeId: string) {
    setRuntimeId(nextRuntimeId);
    // another provider's model list: "" lets ModelInput pick its default
    if (modelProvider(nextRuntimeId) !== modelProvider(runtimeId)) setModel("");
  }

  function handleSave() {
    updateAgentConfig(agent.id, model, runtimeId);
    onDone();
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface-raised p-3">
      <RuntimeSelect value={runtimeId} onChange={handleRuntimeChange} />
      <ModelInput runtimeId={runtimeId} value={model} onChange={setModel} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  );
}
