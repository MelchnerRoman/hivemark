"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { TASK_ROOM_STATUS_LABEL, TASK_ROOM_STATUS_TONE } from "@/lib/display";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { CreateTaskRoomModal } from "@/components/modals/CreateTaskRoomModal";
import type { TaskRoomStatus } from "@/lib/types";

const STATUS_OPTIONS: TaskRoomStatus[] = ["open", "in_progress", "done"];

export function TaskRoomList() {
  const room = useStore((s) => s.rooms.find((r) => r.id === s.selectedRoomId));
  const taskRooms = useStore((s) => s.taskRooms);
  const members = useStore((s) => s.members);
  const selectedTaskRoomId = useStore((s) => s.selectedTaskRoomId);
  const selectTaskRoom = useStore((s) => s.selectTaskRoom);
  const setTaskRoomStatus = useStore((s) => s.setTaskRoomStatus);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusMenuFor, setStatusMenuFor] = useState<string | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statusMenuFor) return;
    function handlePointerDown(e: MouseEvent) {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuFor(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setStatusMenuFor(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [statusMenuFor]);

  if (!room) {
    return (
      <div className="flex w-56 shrink-0 xl:w-72 items-center justify-center border-r border-border bg-background p-6 text-center text-sm text-foreground-muted">
        Select a room to see its Task Rooms.
      </div>
    );
  }

  const roomTaskRooms = taskRooms.filter((t) => t.roomId === room.id);

  return (
    <div className="flex w-56 shrink-0 xl:w-72 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between px-4 py-4">
        <div>
          <h1 className="font-display text-sm font-semibold">
            {room.emoji} {room.name}
          </h1>
          <p className="text-xs text-foreground-muted">{roomTaskRooms.length} task rooms</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised hover:text-foreground"
          aria-label="Create task room"
          title="Create a Task Room"
        >
          +
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {roomTaskRooms.map((tr) => {
          const active = tr.id === selectedTaskRoomId;
          const assignees = members.filter((m) => tr.memberIds.includes(m.id));
          const menuOpen = statusMenuFor === tr.id;
          return (
            <div
              key={tr.id}
              role="button"
              tabIndex={0}
              onClick={() => selectTaskRoom(tr.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectTaskRoom(tr.id);
                }
              }}
              className={`w-full cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors ${
                active
                  ? "border-brand/40 bg-surface-raised"
                  : "border-transparent hover:bg-surface-raised"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-snug">
                  {tr.emoji} {tr.name}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="relative" ref={menuOpen ? statusMenuRef : undefined}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatusMenuFor(menuOpen ? null : tr.id);
                    }}
                    className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    title="Change status"
                  >
                    <Badge tone={TASK_ROOM_STATUS_TONE[tr.status]}>{TASK_ROOM_STATUS_LABEL[tr.status]}</Badge>
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-0 top-full z-10 mt-1 w-36 rounded-lg border border-border bg-surface p-1 shadow-lg"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <button
                          key={status}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setTaskRoomStatus(tr.id, status);
                            setStatusMenuFor(null);
                          }}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                            status === tr.status
                              ? "bg-brand-soft font-medium text-brand"
                              : "text-foreground hover:bg-surface-raised"
                          }`}
                        >
                          {TASK_ROOM_STATUS_LABEL[status]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex -space-x-1.5">
                  {assignees.slice(0, 3).map((m) => (
                    <Avatar key={m.id} label={m.initials} color={m.color} size={20} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {roomTaskRooms.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-foreground-muted">
            No task rooms yet. Create one to start a workflow, loop, or todo list.
          </p>
        )}
      </div>

      <CreateTaskRoomModal open={createOpen} onClose={() => setCreateOpen(false)} roomId={room.id} />
    </div>
  );
}
