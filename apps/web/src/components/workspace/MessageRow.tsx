"use client";

import { memo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { AuthImage } from "@/components/ui/AuthImage";
import { downloadRoomFile, isImagePath } from "@/lib/api";
import { formatTime } from "@/lib/display";

/** One chat message (Task Room chat and DMs). Memoized with only primitive /
 * stable props, so a new message, a keystroke in the composer, or opening an
 * edit box re-renders just the rows involved, not a whole long history. */
export const MessageRow = memo(function MessageRow({
  message,
  name,
  initials,
  color,
  canEdit,
  canDelete,
  isEditing,
  setEditingId,
  onSave,
  onDelete,
  roomId,
}: {
  message: { id: string; content: string; createdAt: string; editedAt: string | null; attachments?: string[] };
  name: string;
  initials: string;
  color: string;
  canEdit: boolean;
  canDelete: boolean;
  isEditing: boolean;
  setEditingId: (id: string | null) => void;
  onSave: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  /** Needed to show attachments (they live in the Room's project folder). */
  roomId?: string;
}) {
  const [editDraft, setEditDraft] = useState("");
  const m = message;

  function save() {
    if (editDraft.trim()) onSave(m.id, editDraft.trim());
    setEditingId(null);
  }

  return (
    // content-visibility lets the browser skip layout/paint for off-screen rows
    // in long histories; the intrinsic size is just the placeholder estimate.
    <div className="group flex gap-3 [contain-intrinsic-size:auto_56px] [content-visibility:auto]">
      <Avatar label={initials} color={color} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-foreground-muted">{formatTime(m.createdAt)}</span>
          {m.editedAt && <span className="text-xs text-foreground-muted">(edited)</span>}
          {!isEditing && (canEdit || canDelete) && (
            <span className="ml-auto flex gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {canEdit && (
                <button
                  onClick={() => {
                    setEditDraft(m.content);
                    setEditingId(m.id);
                  }}
                  className="text-xs text-foreground-muted hover:text-brand"
                >
                  Edit
                </button>
              )}
              {canDelete && (
                <button onClick={() => onDelete(m.id)} className="text-xs text-foreground-muted hover:text-danger">
                  Delete
                </button>
              )}
            </span>
          )}
        </div>
        {isEditing ? (
          <div className="mt-1 flex gap-2">
            <input
              autoFocus
              aria-label="Edit message"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME commit, not a save
                if (e.key === "Enter") save();
                else if (e.key === "Escape") setEditingId(null);
              }}
              className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-brand"
            />
            <button onClick={save} className="text-xs text-brand hover:underline">
              Save
            </button>
            <button onClick={() => setEditingId(null)} className="text-xs text-foreground-muted hover:underline">
              Cancel
            </button>
          </div>
        ) : (
          m.content && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{m.content}</p>
        )}
        {roomId && (m.attachments?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.attachments!.map((p) =>
              isImagePath(p) ? (
                <button key={p} title={`Download ${p}`} onClick={() => downloadRoomFile(roomId, p)}>
                  <AuthImage roomId={roomId} path={p} className="max-h-64 max-w-full rounded-lg border border-border sm:max-w-sm" />
                </button>
              ) : (
                <button
                  key={p}
                  onClick={() => downloadRoomFile(roomId, p)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:border-brand"
                >
                  📄 {p.split("/").pop()}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
});
