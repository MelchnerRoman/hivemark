"use client";

import { FormEvent, KeyboardEvent, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import type { Agent } from "@/lib/types";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Matches an "@" that starts a mention-in-progress at the end of the draft,
// e.g. "hey @Ons" -> captures "Ons". No match once a space follows the "@".
const MENTION_QUERY = /@([^\s@]*)$/;

export function ChatPane({ taskRoomId }: { taskRoomId: string }) {
  const messages = useStore(useShallow((s) => s.messages.filter((m) => m.taskRoomId === taskRoomId)));
  const members = useStore((s) => s.members);
  const agents = useStore((s) => s.agents);
  const sendMessage = useStore((s) => s.sendMessage);
  const editMessage = useStore((s) => s.editMessage);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const currentMemberId = useStore((s) => s.currentMemberId);
  const [draft, setDraft] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const mentionQuery = draft.match(MENTION_QUERY)?.[1];
  const suggestions = useMemo(() => {
    if (mentionQuery === undefined) return [];
    const q = mentionQuery.toLowerCase();
    return agents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 5);
  }, [agents, mentionQuery]);

  function author(authorType: "member" | "agent", authorId: string) {
    if (authorType === "member") {
      const m = members.find((x) => x.id === authorId);
      return { name: m?.name ?? "Unknown", initials: m?.initials ?? "?", color: m?.color ?? "#999" };
    }
    const a = agents.find((x) => x.id === authorId);
    return { name: a ? `${a.name} (agent)` : "Agent", initials: a?.avatarEmoji ?? "🤖", color: a?.color ?? "#5b5cff" };
  }

  function selectMention(agent: Agent) {
    setDraft((d) => d.replace(MENTION_QUERY, `@${agent.name} `));
    setActiveSuggestion(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
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
      setDraft((d) => d.replace(MENTION_QUERY, "@"));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    sendMessage(taskRoomId, draft.trim());
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((m) => {
          const a = author(m.authorType, m.authorId);
          const isOwn = m.authorType === "member" && m.authorId === currentMemberId;
          const canDelete = isOwn || m.authorType === "agent";
          const isEditing = editingId === m.id;
          return (
            <div key={m.id} className="group flex gap-3">
              <Avatar label={a.initials} color={a.color} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="text-xs text-foreground-muted">{formatTime(m.createdAt)}</span>
                  {m.editedAt && <span className="text-xs text-foreground-muted">(edited)</span>}
                  {!isEditing && (isOwn || canDelete) && (
                    <span className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {isOwn && (
                        <button
                          onClick={() => {
                            setEditingId(m.id);
                            setEditDraft(m.content);
                          }}
                          className="text-xs text-foreground-muted hover:text-brand"
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => deleteMessage(m.id)}
                          className="text-xs text-foreground-muted hover:text-danger"
                        >
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
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editDraft.trim()) {
                          editMessage(m.id, editDraft.trim());
                          setEditingId(null);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-brand"
                    />
                    <button
                      onClick={() => {
                        if (editDraft.trim()) editMessage(m.id, editDraft.trim());
                        setEditingId(null);
                      }}
                      className="text-xs text-brand hover:underline"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-foreground-muted hover:underline">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-foreground">{m.content}</p>
                )}
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-foreground-muted">
            No messages yet in this Task Room. Say hello, @mention an agent, or let one kick things off.
          </p>
        )}
      </div>
      <form onSubmit={handleSubmit} className="relative flex gap-2 border-t border-border p-4">
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
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActiveSuggestion(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message this task room… (@ to mention an agent)"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <Button type="submit" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
