"use client";

import { FormEvent, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const statusTone: Record<string, "neutral" | "brand" | "danger"> = {
  idle: "neutral",
  running: "brand",
  error: "danger",
};

export function DirectMessageView() {
  const agentId = useStore((s) => s.selectedDmAgentId);
  const agent = useStore((s) => s.agents.find((a) => a.id === s.selectedDmAgentId));
  const messages = useStore(useShallow((s) => s.directMessages.filter((m) => m.agentId === agentId)));
  const sendDirectMessage = useStore((s) => s.sendDirectMessage);
  const editDirectMessage = useStore((s) => s.editDirectMessage);
  const deleteDirectMessage = useStore((s) => s.deleteDirectMessage);
  const goToAgentInContext = useStore((s) => s.goToAgentInContext);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  if (!agentId || !agent) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
        Select an agent from Direct messages to start a 1:1 conversation.
      </div>
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !agentId) return;
    sendDirectMessage(agentId, draft.trim());
    setDraft("");
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Avatar label={agent.avatarEmoji} color={agent.color} size={32} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-semibold">{agent.name}</h2>
              <Badge tone={statusTone[agent.status]}>{agent.status}</Badge>
            </div>
            <button
              onClick={() => goToAgentInContext(agent.id)}
              className="text-xs text-foreground-muted hover:text-brand hover:underline"
            >
              {agent.model} · Open in task room
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((m) => {
          const isOwn = m.authorType === "member";
          const isEditing = editingId === m.id;
          return (
            <div key={m.id} className="group flex gap-3">
              <Avatar
                label={m.authorType === "agent" ? agent.avatarEmoji : "RM"}
                color={m.authorType === "agent" ? agent.color : "#5b5cff"}
                size={30}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{m.authorType === "agent" ? agent.name : "You"}</span>
                  <span className="text-xs text-foreground-muted">{formatTime(m.createdAt)}</span>
                  {m.editedAt && <span className="text-xs text-foreground-muted">(edited)</span>}
                  {!isEditing && (
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
                      <button
                        onClick={() => deleteDirectMessage(m.id)}
                        className="text-xs text-foreground-muted hover:text-danger"
                      >
                        Delete
                      </button>
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
                          editDirectMessage(m.id, editDraft.trim());
                          setEditingId(null);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-brand"
                    />
                    <button
                      onClick={() => {
                        if (editDraft.trim()) editDirectMessage(m.id, editDraft.trim());
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
            Send {agent.name} a direct message &mdash; it only sees this conversation, not any Task Room chat.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-4">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${agent.name}…`}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <Button type="submit" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
