"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { useStore } from "@/lib/store";

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Search" size="lg">
      {open && <SearchBody onClose={onClose} />}
    </Modal>
  );
}

function SearchBody({ onClose }: { onClose: () => void }) {
  const messages = useStore((s) => s.messages);
  const directMessages = useStore((s) => s.directMessages);
  const todos = useStore((s) => s.todos);
  const agents = useStore((s) => s.agents);
  const taskRooms = useStore((s) => s.taskRooms);
  const rooms = useStore((s) => s.rooms);
  const openTaskRoom = useStore((s) => s.openTaskRoom);
  const openAgentDm = useStore((s) => s.openAgentDm);
  const goToAgentInContext = useStore((s) => s.goToAgentInContext);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  const taskRoomLabel = (taskRoomId: string) => {
    const tr = taskRooms.find((t) => t.id === taskRoomId);
    const room = tr ? rooms.find((r) => r.id === tr.roomId) : undefined;
    return tr ? `${room?.emoji ?? ""} ${room?.name ?? ""} · ${tr.emoji} ${tr.name}` : "Unknown Task Room";
  };

  const results = useMemo(() => {
    if (!q) return null;

    const messageResults = messages
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice(0, 10)
      .map((m) => ({ id: m.id, text: m.content, context: taskRoomLabel(m.taskRoomId), taskRoomId: m.taskRoomId }));

    const dmResults = directMessages
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice(0, 10)
      .map((m) => {
        const agent = agents.find((a) => a.id === m.agentId);
        return { id: m.id, text: m.content, context: agent?.name ?? "Unknown agent", agentId: m.agentId };
      });

    const todoResults = todos
      .filter((t) => t.text.toLowerCase().includes(q))
      .slice(0, 10)
      .map((t) => ({ id: t.id, text: t.text, context: taskRoomLabel(t.taskRoomId), taskRoomId: t.taskRoomId }));

    const agentResults = agents
      .filter((a) => a.name.toLowerCase().includes(q) || a.instructions.toLowerCase().includes(q))
      .slice(0, 10)
      .map((a) => ({ id: a.id, agent: a }));

    return { messageResults, dmResults, todoResults, agentResults };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, messages, directMessages, todos, agents, taskRooms, rooms]);

  const hasAnyResults =
    results &&
    (results.messageResults.length > 0 ||
      results.dmResults.length > 0 ||
      results.todoResults.length > 0 ||
      results.agentResults.length > 0);

  return (
    <div className="space-y-4">
      <input
        aria-label="Search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search messages, todos, agents…"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />

      {!q && <p className="text-sm text-foreground-muted">Type to search across chat, DMs, todos, and agents.</p>}

      {q && !hasAnyResults && <p className="text-sm text-foreground-muted">No results for &ldquo;{query}&rdquo;.</p>}

      {results && results.messageResults.length > 0 && (
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Messages</p>
          <ul className="space-y-1">
            {results.messageResults.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    openTaskRoom(r.taskRoomId, "chat");
                    onClose();
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised"
                >
                  <p className="truncate text-sm">{r.text}</p>
                  <p className="text-xs text-foreground-muted">{r.context}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.dmResults.length > 0 && (
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Direct messages
          </p>
          <ul className="space-y-1">
            {results.dmResults.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    openAgentDm(r.agentId);
                    onClose();
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised"
                >
                  <p className="truncate text-sm">{r.text}</p>
                  <p className="text-xs text-foreground-muted">{r.context}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.todoResults.length > 0 && (
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Todos</p>
          <ul className="space-y-1">
            {results.todoResults.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    openTaskRoom(r.taskRoomId, "todos");
                    onClose();
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised"
                >
                  <p className="truncate text-sm">{r.text}</p>
                  <p className="text-xs text-foreground-muted">{r.context}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.agentResults.length > 0 && (
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Agents</p>
          <ul className="space-y-1">
            {results.agentResults.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    goToAgentInContext(r.agent.id);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised"
                >
                  <Avatar label={r.agent.avatarEmoji} color={r.agent.color} size={22} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.agent.name}</p>
                    <p className="truncate text-xs text-foreground-muted">{r.agent.instructions}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
