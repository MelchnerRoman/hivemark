"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CreateAgentModal } from "@/components/modals/CreateAgentModal";

const statusTone: Record<string, "neutral" | "brand" | "danger"> = {
  idle: "neutral",
  running: "brand",
  error: "danger",
};

export function AgentsPanel({ taskRoomId }: { taskRoomId: string }) {
  const agents = useStore(useShallow((s) => s.agents.filter((a) => a.taskRoomId === taskRoomId)));
  const mcpTools = useStore((s) => s.mcpTools);
  const members = useStore((s) => s.members);
  const toggleAgentTool = useStore((s) => s.toggleAgentTool);
  const removeAgent = useStore((s) => s.removeAgent);
  const runAgent = useStore((s) => s.runAgent);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-foreground-muted">
          Agents created here only act within this task room, using tools your team grants them.
        </p>
        <Button onClick={() => setCreateOpen(true)}>New agent</Button>
      </div>

      <div className="space-y-4">
        {agents.map((agent) => {
          const creator = members.find((m) => m.id === agent.createdById);
          return (
            <div key={agent.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Avatar label={agent.avatarEmoji} color={agent.color} size={32} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-sm font-semibold">{agent.name}</h3>
                      <Badge tone={statusTone[agent.status]}>{agent.status}</Badge>
                    </div>
                    <p className="text-xs text-foreground-muted">
                      {agent.model} · Created by {creator?.name ?? "someone"}
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
                  <button
                    onClick={() => removeAgent(agent.id)}
                    className="text-xs text-foreground-muted hover:text-danger"
                  >
                    Remove
                  </button>
                </div>
              </div>

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
                    return (
                      <div key={tool.id} className="relative">
                        <div
                          className={`flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-xs font-medium transition-colors ${
                            granted
                              ? "border-accent/40 bg-accent-soft text-accent"
                              : "border-border text-foreground-muted hover:bg-surface-raised"
                          }`}
                        >
                          <button
                            onClick={() => {
                              toggleAgentTool(agent.id, tool.id);
                              setExpandedTool(null);
                            }}
                            title={tool.description}
                          >
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
                            <Button
                              variant="secondary"
                              className="w-full text-xs"
                              onClick={() => {
                                toggleAgentTool(agent.id, tool.id);
                                setExpandedTool(null);
                              }}
                            >
                              Grant access
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {agents.length === 0 && (
          <p className="pt-10 text-center text-sm text-foreground-muted">
            No agents in this task room yet. Create one and grant it MCP tools to get started.
          </p>
        )}
      </div>

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} taskRoomId={taskRoomId} />
    </div>
  );
}
