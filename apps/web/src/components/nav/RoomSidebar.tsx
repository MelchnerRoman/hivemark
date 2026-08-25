"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { getToken } from "@/lib/auth";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { CreateRoomModal } from "@/components/modals/CreateRoomModal";
import { RoomSettingsModal } from "@/components/modals/RoomSettingsModal";
import { AgentSettingsModal } from "@/components/modals/AgentSettingsModal";
import { SearchModal } from "@/components/modals/SearchModal";

const SEARCH_THRESHOLD = 6;

export function RoomSidebar() {
  const rooms = useStore((s) => s.rooms);
  const selectedRoomId = useStore((s) => s.selectedRoomId);
  const selectRoom = useStore((s) => s.selectRoom);
  const members = useStore((s) => s.members);
  const currentMemberId = useStore((s) => s.currentMemberId);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const agents = useStore((s) => s.agents);
  const selectedDmAgentId = useStore((s) => s.selectedDmAgentId);
  const openAgentDm = useStore((s) => s.openAgentDm);
  const logout = useStore((s) => s.logout);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsRoomId, setSettingsRoomId] = useState<string | null>(null);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const me = members.find((m) => m.id === currentMemberId);
  const settingsRoom = rooms.find((r) => r.id === settingsRoomId) ?? null;

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(q));
  }, [rooms, query]);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center justify-between px-4 py-4">
        <Logo size={22} />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-raised hover:text-foreground"
            aria-label="Search"
            title="Search"
          >
            🔍
          </button>
          <button
            onClick={() => setAgentSettingsOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-raised hover:text-foreground"
            aria-label="Agent settings"
            title="Agent settings"
          >
            ⚙️
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className="px-2 pb-1">
        <button
          onClick={() => setView("agents")}
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
            view === "agents" ? "bg-brand-soft font-medium text-brand" : "text-foreground hover:bg-surface-raised"
          }`}
        >
          <span className="text-base leading-none">🤖</span>
          <span>Agents</span>
          {agents.length > 0 && (
            <span className="ml-auto rounded-full bg-surface-raised px-1.5 text-xs text-foreground-muted">
              {agents.length}
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Rooms</span>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex h-5 w-5 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised hover:text-foreground"
            aria-label="Create room"
            title="Create a Team/Project Room"
          >
            +
          </button>
        </div>

        {rooms.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
            <span className="text-2xl">🗂️</span>
            <div>
              <p className="text-sm font-medium">No rooms yet</p>
              <p className="mt-1 text-xs text-foreground-muted">
                Create your first Team or Project Room to start organizing work.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>Create your first room</Button>
          </div>
        ) : (
          <>
            {rooms.length > SEARCH_THRESHOLD && (
              <div className="px-3 pb-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search rooms…"
                  aria-label="Search rooms"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                />
              </div>
            )}

            <nav className="space-y-0.5 px-2">
              {filteredRooms.map((room) => {
                const active = view === "rooms" && room.id === selectedRoomId;
                return (
                  <div key={room.id} className="group relative">
                    <button
                      onClick={() => selectRoom(room.id)}
                      className={`flex w-full items-center gap-2 rounded-lg py-2 pl-2.5 pr-8 text-left text-sm transition-colors ${
                        active
                          ? "bg-brand-soft font-medium text-brand"
                          : "text-foreground hover:bg-surface-raised"
                      }`}
                    >
                      <span className="text-base leading-none">{room.emoji}</span>
                      <span className="truncate">{room.name}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettingsRoomId(room.id);
                      }}
                      className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-foreground-muted opacity-0 transition-opacity hover:bg-surface-raised hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                      aria-label={`Room settings for ${room.name}`}
                      title="Room settings"
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}

              {filteredRooms.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-foreground-muted">
                  No rooms match &ldquo;{query}&rdquo;.
                </p>
              )}
            </nav>
          </>
        )}

        {agents.length > 0 && (
          <div className="mt-4">
            <div className="px-4 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                Direct messages
              </span>
            </div>
            <nav className="space-y-0.5 px-2">
              {agents.map((agent) => {
                const active = view === "dm" && agent.id === selectedDmAgentId;
                return (
                  <button
                    key={agent.id}
                    onClick={() => openAgentDm(agent.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                      active ? "bg-brand-soft font-medium text-brand" : "text-foreground hover:bg-surface-raised"
                    }`}
                  >
                    <Avatar label={agent.avatarEmoji} color={agent.color} size={20} />
                    <span className="truncate">{agent.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        {me && <Avatar label={me.initials} color={me.color} size={28} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{me?.name}</p>
          <p className="truncate text-xs text-foreground-muted">Online</p>
        </div>
        {/* Only shown when a real OAuth session exists — the default
            single-user local mode has no login to log out of. */}
        {getToken() && (
          <button
            onClick={logout}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised hover:text-danger"
            aria-label="Log out"
            title="Log out"
          >
            ⏻
          </button>
        )}
      </div>

      <CreateRoomModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <RoomSettingsModal
        room={settingsRoom}
        open={settingsRoomId !== null}
        onClose={() => setSettingsRoomId(null)}
      />
      <AgentSettingsModal open={agentSettingsOpen} onClose={() => setAgentSettingsOpen(false)} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </aside>
  );
}
