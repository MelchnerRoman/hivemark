"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { AgentSettingsModal } from "@/components/modals/AgentSettingsModal";
import { CreateAgentModal } from "@/components/modals/CreateAgentModal";
import { CreateAgentTeamModal } from "@/components/modals/CreateAgentTeamModal";
import { AddTeamToRoomModal } from "@/components/modals/AddTeamToRoomModal";
import type { Agent, AgentTeam } from "@/lib/types";

const TEAM_AVATAR_LIMIT = 4;

const MODE_LABEL: Record<AgentTeam["mode"], string> = {
  auto: "Auto",
  manual: "Manual",
};

export function AgentsGalleryView() {
  const agents = useStore((s) => s.agents);
  const agentTeams = useStore((s) => s.agentTeams);
  const taskRooms = useStore((s) => s.taskRooms);
  const rooms = useStore((s) => s.rooms);
  const runAgent = useStore((s) => s.runAgent);
  const stopAgent = useStore((s) => s.stopAgent);
  const stopAllAgents = useStore((s) => s.stopAllAgents);
  const removeAgent = useStore((s) => s.removeAgent);
  const removeAgentTeam = useStore((s) => s.removeAgentTeam);
  const currentMemberId = useStore((s) => s.currentMemberId);
  const isOwner = useStore((s) => s.members.find((m) => m.id === s.currentMemberId)?.role === "owner");
  const goToAgentInContext = useStore((s) => s.goToAgentInContext);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [teamMenuOpenId, setTeamMenuOpenId] = useState<string | null>(null);
  const [addTeamModalId, setAddTeamModalId] = useState<string | null>(null);

  const runningCount = agents.filter((a) => a.status === "running").length;
  const addTeamModalTeam = agentTeams.find((t) => t.id === addTeamModalId) ?? null;

  function contextFor(agent: Agent) {
    const taskRoom = taskRooms.find((t) => t.id === agent.taskRoomId);
    const room = taskRoom ? rooms.find((r) => r.id === taskRoom.roomId) : undefined;
    return { taskRoom, room };
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Agents</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Every AI Agent across your rooms, in one place. Set up and manage them here.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={taskRooms.length === 0}
            title={taskRooms.length === 0 ? "Create a Task Room first" : undefined}
            onClick={() => setCreateAgentOpen(true)}
          >
            New agent
          </Button>
          <Button variant="secondary" onClick={() => setDefaultsOpen(true)}>
            Agent settings
          </Button>
          <Button variant="secondary" disabled={runningCount === 0} onClick={() => stopAllAgents()}>
            Stop running agents{runningCount > 0 ? ` (${runningCount})` : ""}
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-20 text-center">
          <span className="text-2xl">🤖</span>
          <p className="text-sm font-medium">No agents yet</p>
          <p className="max-w-sm text-xs text-foreground-muted">
            Create one here, or open any Task Room and use its Agents tab.
          </p>
          {taskRooms.length > 0 && (
            <Button onClick={() => setCreateAgentOpen(true)}>Create your first agent</Button>
          )}
        </div>
      ) : (
        <div
          onClick={() => openMenuId && setOpenMenuId(null)}
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          {agents.map((agent) => {
            const { taskRoom, room } = contextFor(agent);
            const menuOpen = openMenuId === agent.id;
            return (
              <div
                key={agent.id}
                onClick={() => goToAgentInContext(agent.id)}
                className="group relative flex cursor-pointer flex-col items-center rounded-xl border border-border bg-surface p-5 text-center transition-colors hover:border-brand/40"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(menuOpen ? null : agent.id);
                  }}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted opacity-0 transition-opacity hover:bg-surface-raised hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Options for ${agent.name}`}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-2 top-9 z-10 w-40 rounded-lg border border-border bg-surface p-1 text-left shadow-xl"
                  >
                    <button
                      onClick={() => {
                        goToAgentInContext(agent.id);
                        setOpenMenuId(null);
                      }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised"
                    >
                      Open in task room
                    </button>
                    <button
                      onClick={() => {
                        setConfirmRemoveId(agent.id);
                        setOpenMenuId(null);
                      }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-danger hover:bg-danger-soft"
                    >
                      Remove agent
                    </button>
                  </div>
                )}

                <div className="relative">
                  <Avatar label={agent.avatarEmoji} color={agent.color} size={64} />
                  {agent.status === "idle" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        runAgent(agent.id);
                      }}
                      title="Run agent"
                      aria-label={`Run ${agent.name}`}
                      className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-brand text-brand-foreground shadow-sm hover:opacity-90"
                    >
                      <span className="ml-0.5 text-[10px] leading-none">▶</span>
                    </button>
                  )}
                  {agent.status === "running" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        stopAgent(agent.id);
                      }}
                      title="Stop agent"
                      aria-label={`Stop ${agent.name}`}
                      className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 animate-pulse items-center justify-center rounded-full border-2 border-surface bg-brand text-brand-foreground shadow-sm hover:opacity-90"
                    >
                      <span className="h-2 w-2 rounded-sm bg-brand-foreground" />
                    </button>
                  )}
                  {agent.status === "error" && (
                    <span
                      title="Error"
                      className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-surface bg-danger"
                    />
                  )}
                </div>

                <p className="mt-3 text-sm font-medium">{agent.name}</p>
                <p className="text-xs text-foreground-muted">{agent.model}</p>
                {taskRoom && (
                  <p className="mt-1 truncate text-[11px] text-foreground-muted/80">
                    {room?.emoji} {taskRoom.emoji} {taskRoom.name}
                    {agent.roomId && " · Room-wide"}
                  </p>
                )}
                {confirmRemoveId === agent.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-3 flex w-full cursor-default flex-wrap items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
                  >
                    <span className="w-full">Remove {agent.name}? This can&apos;t be undone.</span>
                    <Button variant="ghost" onClick={() => setConfirmRemoveId(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        removeAgent(agent.id);
                        setConfirmRemoveId(null);
                      }}
                    >
                      Remove agent
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-10">
        <h2 className="font-display text-lg font-semibold">Agent teams</h2>
        <p className="mt-1 text-sm text-foreground-muted">Group agents that you can add to a Task Room together.</p>

        <div
          onClick={() => teamMenuOpenId && setTeamMenuOpenId(null)}
          className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          {agentTeams.map((team) => {
            const memberAgents = team.agentIds
              .map((agentId) => agents.find((a) => a.id === agentId))
              .filter((a): a is Agent => Boolean(a));
            const visible = memberAgents.slice(0, TEAM_AVATAR_LIMIT);
            const overflow = memberAgents.length - visible.length;
            const menuOpen = teamMenuOpenId === team.id;
            return (
              <div
                key={team.id}
                className="group relative flex flex-col rounded-xl border border-border bg-surface p-5"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTeamMenuOpenId(menuOpen ? null : team.id);
                  }}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted opacity-0 transition-opacity hover:bg-surface-raised hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Options for ${team.name}`}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-2 top-9 z-10 w-44 rounded-lg border border-border bg-surface p-1 text-left shadow-xl"
                  >
                    <button
                      onClick={() => {
                        setAddTeamModalId(team.id);
                        setTeamMenuOpenId(null);
                      }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised"
                    >
                      Add to a Task Room
                    </button>
                    {(team.createdById === currentMemberId || isOwner) && (
                      <button
                        onClick={() => {
                          removeAgentTeam(team.id);
                          setTeamMenuOpenId(null);
                        }}
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-danger hover:bg-danger-soft"
                      >
                        Delete team
                      </button>
                    )}
                  </div>
                )}

                <div className="mb-4 flex">
                  {visible.map((agent, i) => (
                    <div key={agent.id} className={i > 0 ? "-ml-3" : ""} style={{ zIndex: visible.length - i }}>
                      <Avatar label={agent.avatarEmoji} color={agent.color} size={56} />
                    </div>
                  ))}
                  {overflow > 0 && (
                    <div className="-ml-3 flex h-14 w-14 items-center justify-center rounded-full border-2 border-surface bg-surface-raised text-sm font-medium text-foreground-muted">
                      +{overflow}
                    </div>
                  )}
                </div>

                <p className="text-sm font-semibold">{team.name}</p>
                <p className="text-xs text-foreground-muted">{MODE_LABEL[team.mode]}</p>
              </div>
            );
          })}

          <button
            onClick={() => setCreateTeamOpen(true)}
            className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-foreground-muted transition-colors hover:border-brand/40 hover:text-brand"
          >
            <span className="text-xl leading-none">+</span>
            <span className="text-sm font-medium">New team</span>
          </button>
        </div>
      </div>

      <AgentSettingsModal open={defaultsOpen} onClose={() => setDefaultsOpen(false)} />
      <CreateAgentModal open={createAgentOpen} onClose={() => setCreateAgentOpen(false)} />
      <CreateAgentTeamModal open={createTeamOpen} onClose={() => setCreateTeamOpen(false)} />
      <AddTeamToRoomModal
        team={addTeamModalTeam}
        open={addTeamModalId !== null}
        onClose={() => setAddTeamModalId(null)}
      />
    </div>
  );
}
