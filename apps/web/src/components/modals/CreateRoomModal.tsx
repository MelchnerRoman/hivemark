"use client";

import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useStore } from "@/lib/store";

const EMOJI_OPTIONS = ["🧩", "🚀", "🛠️", "📈", "🎯", "🔐", "🧠", "🗂️"];

export function CreateRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createRoom = useStore((s) => s.createRoom);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI_OPTIONS[0]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createRoom(name.trim(), emoji);
    setName("");
    setEmoji(EMOJI_OPTIONS[0]);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New Team/Project Room">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Room name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Growth Team"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Icon</label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt}
                onClick={() => setEmoji(opt)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base ${
                  emoji === opt ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-raised"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            Create room
          </Button>
        </div>
      </form>
    </Modal>
  );
}
