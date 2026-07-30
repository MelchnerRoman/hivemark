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
  const [addingId, setAddingId] = useState("");

  if (!room) return null;

  const roomMembers = members.filter((m) => room.memberIds.includes(m.id));
  const availableMembers = members.filter((m) => !room.memberIds.includes(m.id));

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
                {m.id !== currentMemberId && (
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

        <div className="flex justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
