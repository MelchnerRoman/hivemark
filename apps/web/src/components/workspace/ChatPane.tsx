"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { uploadRoomFile } from "@/lib/api";
import { useStickToBottom } from "@/lib/useStickToBottom";
import { MessageRow } from "./MessageRow";
import type { Agent } from "@/lib/types";

// Matches an "@" that starts a mention-in-progress at the end of the draft,
// e.g. "hey @Ons" -> captures "Ons". No match once a space follows the "@".
const MENTION_QUERY = /@([^\s@]*)$/;

export function ChatPane({ taskRoomId }: { taskRoomId: string }) {
  const messages = useStore(useShallow((s) => s.messages.filter((m) => m.taskRoomId === taskRoomId)));
  const members = useStore((s) => s.members);
  const agents = useStore((s) => s.agents);
  const editMessage = useStore((s) => s.editMessage);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const currentMemberId = useStore((s) => s.currentMemberId);
  const roomId = useStore((s) => s.taskRooms.find((t) => t.id === taskRoomId)?.roomId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { ref, onScroll } = useStickToBottom(messages, taskRoomId);

  function author(authorType: "member" | "agent", authorId: string) {
    if (authorType === "member") {
      const m = members.find((x) => x.id === authorId);
      return { name: m?.name ?? "Unknown", initials: m?.initials ?? "?", color: m?.color ?? "#999" };
    }
    const a = agents.find((x) => x.id === authorId);
    return { name: a ? `${a.name} (agent)` : "Agent", initials: a?.avatarEmoji ?? "🤖", color: a?.color ?? "#5b5cff" };
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={ref} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((m) => {
          const a = author(m.authorType, m.authorId);
          // Optimistic (tmp-) messages don't exist server-side yet.
          const isOwn = m.authorType === "member" && m.authorId === currentMemberId && !m.id.startsWith("tmp-");
          return (
            <MessageRow
              key={m.id}
              message={m}
              name={a.name}
              initials={a.initials}
              color={a.color}
              canEdit={isOwn}
              canDelete={isOwn || m.authorType === "agent"}
              isEditing={editingId === m.id}
              setEditingId={setEditingId}
              onSave={editMessage}
              onDelete={deleteMessage}
              roomId={roomId}
            />
          );
        })}
        {messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-foreground-muted">
            No messages yet in this Task Room. Say hello, @mention an agent, or let one kick things off.
          </p>
        )}
      </div>
      <ChatComposer key={taskRoomId} taskRoomId={taskRoomId} roomId={roomId} />
    </div>
  );
}

/** Own component so the draft (re-rendered on every keystroke) doesn't
 * re-render the whole message history above it. */
function ChatComposer({ taskRoomId, roomId }: { taskRoomId: string; roomId: string | undefined }) {
  const agents = useStore((s) => s.agents);
  const sendMessage = useStore((s) => s.sendMessage);
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [mentionsDismissed, setMentionsDismissed] = useState(false);

  const mentionQuery = draft.match(MENTION_QUERY)?.[1];
  const suggestions = useMemo(() => {
    if (mentionQuery === undefined || mentionsDismissed) return [];
    const q = mentionQuery.toLowerCase();
    return agents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 5);
  }, [agents, mentionQuery, mentionsDismissed]);

  function selectMention(agent: Agent) {
    setDraft((d) => d.replace(MENTION_QUERY, `@${agent.name} `));
    setActiveSuggestion(0);
  }

  // Files land in the Room's shared project folder (uploads/), where agents'
  // file tools can also reach them — the message just references the paths.
  async function uploadFiles(files: File[]) {
    if (!roomId || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const { path } = await uploadRoomFile(roomId, `uploads/${Date.now()}-${file.name}`, file);
        setPendingAttachments((a) => [...a, path]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter that commits an IME composition (Japanese, Chinese…) must not send
    // or pick a mention. Safari reports it as keyCode 229 with isComposing false.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (suggestions.length === 0) {
      if (e.key === "Enter" && !e.shiftKey) handleSubmit(e);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(suggestions[activeSuggestion]);
    } else if (e.key === "Escape") {
      setMentionsDismissed(true);
    }
  }

  const canSend = (draft.trim().length > 0 || pendingAttachments.length > 0) && !uploading;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    sendMessage(taskRoomId, draft.trim(), pendingAttachments);
    setDraft("");
    setPendingAttachments([]);
  }

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // Only intercept file drops — dragged text should still land in the textarea.
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        void uploadFiles([...e.dataTransfer.files]);
      }}
      className="relative flex items-end gap-2 border-t border-border p-4"
    >
      {(pendingAttachments.length > 0 || uploading) && (
        <div className="absolute bottom-full left-4 right-4 mb-1 flex flex-wrap gap-1.5">
          {pendingAttachments.map((p) => (
            <span key={p} className="flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs text-brand">
              {p.split("/").pop()?.replace(/^\d+-/, "")}
              <button
                type="button"
                aria-label={`Remove ${p}`}
                onClick={() => setPendingAttachments((a) => a.filter((x) => x !== p))}
              >
                ×
              </button>
            </span>
          ))}
          {uploading && <span className="px-2 py-1 text-xs text-foreground-muted">Uploading…</span>}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void uploadFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="secondary"
        aria-label="Attach files"
        disabled={!roomId}
        onClick={() => fileInput.current?.click()}
      >
        📎
      </Button>
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-4 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          {suggestions.map((agent, i) => (
            <button
              type="button"
              key={agent.id}
              onMouseDown={(e) => {
                e.preventDefault();
                selectMention(agent);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                i === activeSuggestion ? "bg-brand-soft text-brand" : "hover:bg-surface-raised"
              }`}
            >
              <Avatar label={agent.avatarEmoji} color={agent.color} size={22} />
              {agent.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={draft}
        rows={Math.min(8, draft.split("\n").length)}
        onChange={(e) => {
          setDraft(e.target.value);
          setActiveSuggestion(0);
          setMentionsDismissed(false);
        }}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            void uploadFiles(files);
          }
        }}
        aria-label="Message"
        placeholder="Message this task room… (@ to mention an agent, Shift+Enter for a new line, paste or drop files)"
        className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <Button type="submit" disabled={!canSend}>
        Send
      </Button>
    </form>
  );
}
