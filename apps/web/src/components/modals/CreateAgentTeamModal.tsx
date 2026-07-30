"use client";

import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useStore } from "@/lib/store";
import type { AgentTeamMode } from "@/lib/types";

export function CreateAgentTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="New agent team">
      {/* Keyed on `open` so each time the modal opens it remounts with a
          fresh, empty selection instead of syncing via effect. */}
      {open && <CreateAgentTeamForm key={String(open)} onClose={onClose} />}
    </Modal>
  );
}

function CreateAgentTeamForm({ onClose }: { onClose: () => void }) {
  const agents = useStore((s) => s.agents);
  const taskRooms = useStore((s) => s.taskRooms);
  const rooms = useStore((s) => s.rooms);
  const createAgentTeam = useStore((s) => s.createAgentTeam);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<AgentTeamMode>("auto");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggleAgent(agentId: string) {
    setSelectedIds((ids) => (ids.includes(agentId) ? ids.filter((id) => id !== agentId) : [...ids, agentId]));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || selectedIds.length === 0) return;
    createAgentTeam(name.trim(), selectedIds, mode);
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Team name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Launch Crew"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as AgentTeamMode)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="auto">Auto &mdash; agents coordinate on their own</option>
          <option value="manual">Manual &mdash; you run each agent yourself</option>
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
          Members ({selectedIds.length} selected)
        </label>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
          {agents.map((agent) => {
            const taskRoom = taskRooms.find((t) => t.id === agent.taskRoomId);
            const room = taskRoom ? rooms.find((r) => r.id === taskRoom.roomId) : undefined;
            const checked = selectedIds.includes(agent.id);
            return (
              <label
                key={agent.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
                  checked ? "bg-brand-soft" : "hover:bg-surface-raised"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAgent(agent.id)}
                  className="h-4 w-4 rounded border-border accent-[var(--brand)]"
                />
                <Avatar label={agent.avatarEmoji} color={agent.color} size={24} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{agent.name}</p>
                  {taskRoom && (
                    <p className="truncate text-xs text-foreground-muted">
                      {room?.emoji} {taskRoom.emoji} {taskRoom.name}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
          {agents.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-foreground-muted">
              No agents yet &mdash; create one from any Task Room first.
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-foreground-muted">
        Teams group existing agents so you can drop the whole squad into a Task Room together.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || selectedIds.length === 0}>
          Create team
        </Button>
      </div>
    </form>
  );
}
