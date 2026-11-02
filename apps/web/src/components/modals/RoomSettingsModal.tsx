"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useStore } from "@/lib/store";
import type { Room } from "@/lib/types";

export function RoomSettingsModal({
  room,
  open,
  onClose,
}: {
  room: Room | null;
  open: boolean;
  onClose: () => void;
}) {
  const members = useStore((s) => s.members);
  const currentMemberId = useStore((s) => s.currentMemberId);
  const addMemberToRoom = useStore((s) => s.addMemberToRoom);
  const removeMemberFromRoom = useStore((s) => s.removeMemberFromRoom);
  const taskRooms = useStore((s) => s.taskRooms);
  const agents = useStore((s) => s.agents);
  const agentTeams = useStore((s) => s.agentTeams);
  const addAgentToRoom = useStore((s) => s.addAgentToRoom);
  const removeAgentFromRoom = useStore((s) => s.removeAgentFromRoom);
  const addTeamToRoom = useStore((s) => s.addTeamToRoom);
  const [addingId, setAddingId] = useState("");
  const [addingAgentId, setAddingAgentId] = useState("");
  const [addingTeamId, setAddingTeamId] = useState("");

  if (!room) return null;

  const isOwner = members.find((m) => m.id === currentMemberId)?.role === "owner";
  const roomMembers = members.filter((m) => room.memberIds.includes(m.id));
  const availableMembers = members.filter((m) => !room.memberIds.includes(m.id));

  const roomTaskRoomIds = new Set(taskRooms.filter((t) => t.roomId === room.id).map((t) => t.id));
  const roomWideAgents = agents.filter((a) => a.roomId === room.id);
  const availableAgents = agents.filter((a) => a.roomId !== room.id && roomTaskRoomIds.has(a.taskRoomId));

  return (
    <Modal open={open} onClose={onClose} title={`${room.emoji} ${room.name}`}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            {roomMembers.length} member{roomMembers.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-1">
            {roomMembers.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-surface-raised"
              >
                <div className="flex items-center gap-2">
                  <Avatar label={m.initials} color={m.color} size={26} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-tight">{m.name}</p>
                    <p className="text-xs capitalize text-foreground-muted">{m.role}</p>
                  </div>
                </div>
                {m.id !== currentMemberId && isOwner && (
                  <button
                    type="button"
                    onClick={() => removeMemberFromRoom(room.id, m.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {availableMembers.length > 0 && (
          <div className="border-t border-border pt-3">
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Add member</label>
            <div className="flex gap-2">
              <select
                value={addingId}
                onChange={(e) => setAddingId(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              >
                <option value="">Choose a member…</option>
                {availableMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                disabled={!addingId}
                onClick={() => {
                  if (!addingId) return;
                  addMemberToRoom(room.id, addingId);
                  setAddingId("");
                }}
              >
                Add
              </Button>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Room-wide agents
          </p>
          <p className="mb-2 text-xs text-foreground-muted">
            These agents are mentionable in every Task Room in this Room, not just where they were created.
          </p>
          {roomWideAgents.length > 0 && (
            <ul className="mb-2 space-y-1">
              {roomWideAgents.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-surface-raised">
                  <div className="flex items-center gap-2">
                    <Avatar label={a.avatarEmoji} color={a.color} size={26} />
                    <p className="truncate text-sm font-medium leading-tight">{a.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAgentFromRoom(room.id, a.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {availableAgents.length > 0 ? (
            <div className="flex gap-2">
              <select
                value={addingAgentId}
                onChange={(e) => setAddingAgentId(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              >
                <option value="">Choose an agent…</option>
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                disabled={!addingAgentId}
                onClick={() => {
                  if (!addingAgentId) return;
                  addAgentToRoom(room.id, addingAgentId);
                  setAddingAgentId("");
                }}
              >
                Add
              </Button>
            </div>
          ) : (
            <p className="text-xs text-foreground-muted">
              No other agents in this Room&apos;s Task Rooms yet to add.
            </p>
          )}

          {agentTeams.length > 0 && (
            <div className="mt-3 flex gap-2">
              <select
                value={addingTeamId}
                onChange={(e) => setAddingTeamId(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              >
                <option value="">Choose a team…</option>
                {agentTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                disabled={!addingTeamId}
                onClick={() => {
                  if (!addingTeamId) return;
                  addTeamToRoom(room.id, addingTeamId);
                  setAddingTeamId("");
                }}
              >
                Add team
              </Button>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end bg-surface py-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
