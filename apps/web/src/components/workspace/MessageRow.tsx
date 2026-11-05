"use client";

import { memo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { AuthImage } from "@/components/ui/AuthImage";
import { downloadRoomFile, isImagePath } from "@/lib/api";
import { attachmentName, formatTime } from "@/lib/display";
import type { MessageMeta } from "@/lib/types";

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
  message: { id: string; content: string; createdAt: string; editedAt: string | null; attachments?: string[]; meta?: MessageMeta };
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

  // The trace a stopped turn leaves — a muted line, not a message.
  if (m.meta?.stoppedBy) {
    return (
      <p className="pl-[42px] text-xs text-foreground-muted">
        ⏹ {name} · {m.content} · {formatTime(m.createdAt)}
      </p>
    );
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
        {m.meta?.tools && m.meta.tools.length > 0 && <ToolTrace tools={m.meta.tools} />}
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
                  📄 {attachmentName(p)}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/** "Used tools: echo, read_file (3)" — expands to each call and its input. */
function ToolTrace({ tools }: { tools: NonNullable<MessageMeta["tools"]> }) {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  // MCP tools are "<server>__<tool>" — the tool part is what reads well.
  const short = (name: string) => name.split("__").at(-1)!;
  const summary = [...counts].map(([name, n]) => (n > 1 ? `${short(name)} (${n})` : short(name))).join(", ");
  return (
    <details className="mt-1.5 text-xs text-foreground-muted">
      <summary className="cursor-pointer select-none hover:text-foreground">Used tools: {summary}</summary>
      <ul className="mt-1 space-y-0.5 border-l border-border pl-3 font-mono">
        {tools.map((t, i) => (
          <li key={i} className="break-all">
            {t.name}
            {t.input && <span className="opacity-70"> {t.input}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Typing-style row under the messages while an agent works on a reply in
 * this conversation. `onStop` only when the viewer may stop that turn. */
export function WorkingRow({
  name,
  avatarEmoji,
  color,
  onStop,
}: {
  name: string;
  avatarEmoji: string;
  color: string;
  onStop?: () => void;
}) {
  return (
    <div className="flex items-center gap-3" role="status">
      <Avatar label={avatarEmoji} color={color} size={30} />
      <span className="animate-pulse text-sm text-foreground-muted">{name} is working…</span>
      {onStop && (
        <button onClick={onStop} className="text-xs text-foreground-muted hover:text-danger" aria-label={`Stop ${name}`}>
          Stop
        </button>
      )}
    </div>
  );
}
