"use client";

import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import type { AgentTeam } from "@/lib/types";

export function AddTeamToRoomModal({
  team,
  open,
  onClose,
}: {
  team: AgentTeam | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={team ? `Add "${team.name}" to a Task Room` : "Add team"}>
      {open && team && <AddTeamToRoomForm key={team.id} team={team} onClose={onClose} />}
    </Modal>
  );
}

function AddTeamToRoomForm({ team, onClose }: { team: AgentTeam; onClose: () => void }) {
  const taskRooms = useStore((s) => s.taskRooms);
  const rooms = useStore((s) => s.rooms);
  const addTeamToTaskRoom = useStore((s) => s.addTeamToTaskRoom);
  const [taskRoomId, setTaskRoomId] = useState(taskRooms[0]?.id ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!taskRoomId) return;
    addTeamToTaskRoom(team.id, taskRoomId);
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-foreground-muted">
        This clones all {team.agentIds.length} agent{team.agentIds.length === 1 ? "" : "s"} in{" "}
        <span className="font-medium text-foreground">{team.name}</span> into the Task Room you pick, ready to
        configure MCP tool access there.
      </p>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Task Room</label>
        <select
          value={taskRoomId}
          onChange={(e) => setTaskRoomId(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {taskRooms.map((tr) => {
            const room = rooms.find((r) => r.id === tr.roomId);
            return (
              <option key={tr.id} value={tr.id}>
                {room?.emoji} {room?.name} · {tr.emoji} {tr.name}
              </option>
            );
          })}
        </select>
        {taskRooms.length === 0 && (
          <p className="mt-1.5 text-xs text-foreground-muted">Create a Task Room first.</p>
        )}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 bg-surface py-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!taskRoomId}>
          Add team
        </Button>
      </div>
    </form>
  );
}
