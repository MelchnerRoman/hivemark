"use client";

import { FormEvent, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { AGENT_STATUS_TONE } from "@/lib/display";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MessageRow } from "@/components/workspace/MessageRow";
import { AgentFiles } from "@/components/workspace/FilesPanel";
import { useStickToBottom } from "@/lib/useStickToBottom";

export function DirectMessageView() {
  const agentId = useStore((s) => s.selectedDmAgentId);
  const agent = useStore((s) => s.agents.find((a) => a.id === s.selectedDmAgentId));
  const messages = useStore(useShallow((s) => s.directMessages.filter((m) => m.agentId === agentId)));
  const editDirectMessage = useStore((s) => s.editDirectMessage);
  const deleteDirectMessage = useStore((s) => s.deleteDirectMessage);
  const goToAgentInContext = useStore((s) => s.goToAgentInContext);
  const me = useStore((s) => s.members.find((m) => m.id === s.currentMemberId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const { ref, onScroll } = useStickToBottom(messages, agentId ?? "");

  if (!agentId || !agent) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
        Select an agent from Direct messages to start a 1:1 conversation.
      </div>
    );
  }


  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Avatar label={agent.avatarEmoji} color={agent.color} size={32} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-semibold">{agent.name}</h2>
              <Badge tone={AGENT_STATUS_TONE[agent.status]}>{agent.status}</Badge>
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
      <div className="border-b border-border px-6 py-3">
        <AgentFiles key={agent.id} agentId={agent.id} dm title="Files from this chat (only you can see them)" />
      </div>

      <div ref={ref} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((m) => {
          const isAgent = m.authorType === "agent";
          // Optimistic (tmp-) messages don't exist server-side yet.
          const isSaved = !m.id.startsWith("tmp-");
          return (
            <MessageRow
              key={m.id}
              message={m}
              name={isAgent ? agent.name : "You"}
              initials={isAgent ? agent.avatarEmoji : (me?.initials ?? "?")}
              color={isAgent ? agent.color : (me?.color ?? "#5b5cff")}
              canEdit={!isAgent && isSaved}
              canDelete={isSaved}
              isEditing={editingId === m.id}
              setEditingId={setEditingId}
              onSave={editDirectMessage}
              onDelete={deleteDirectMessage}
            />
          );
        })}
        {messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-foreground-muted">
            {`Send ${agent.name} a direct message — it only sees this conversation, not any Task Room chat.`}
          </p>
        )}
      </div>

      <DmComposer agentId={agent.id} agentName={agent.name} />
    </div>
  );
}

/** Own component so typing doesn't re-render the conversation above it. */
function DmComposer({ agentId, agentName }: { agentId: string; agentName: string }) {
  const sendDirectMessage = useStore((s) => s.sendDirectMessage);
  const [draft, setDraft] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    sendDirectMessage(agentId, draft.trim());
    setDraft("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-4">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`Message ${agentName}`}
        placeholder={`Message ${agentName}…`}
        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <Button type="submit" disabled={!draft.trim()}>
        Send
      </Button>
    </form>
  );
}
