"use client";

import { FormEvent, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import type { TodoItem } from "@/lib/types";

type TodoFilter = "all" | "mine" | "unassigned";

const FILTERS: { id: TodoFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "unassigned", label: "Unassigned" },
];

export function TodosPanel({ taskRoomId }: { taskRoomId: string }) {
  const allTodos = useStore(useShallow((s) => s.todos.filter((t) => t.taskRoomId === taskRoomId)));
  const members = useStore((s) => s.members);
  const currentMemberId = useStore((s) => s.currentMemberId);
  const addTodo = useStore((s) => s.addTodo);
  const toggleTodo = useStore((s) => s.toggleTodo);
  const [text, setText] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [filter, setFilter] = useState<TodoFilter>("all");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    addTodo(taskRoomId, text.trim(), assigneeId || null, dueDate || null);
    setText("");
    setDueDate("");
  }

  const todos = useMemo(() => {
    if (filter === "mine") return allTodos.filter((t) => t.assigneeId === currentMemberId);
    if (filter === "unassigned") return allTodos.filter((t) => t.assigneeId === null);
    return allTodos;
  }, [allTodos, filter, currentMemberId]);

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <form onSubmit={handleSubmit} noValidate className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a todo…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          title="Due date (optional)"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
        />
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={!text.trim()}>
          Add
        </Button>
      </form>

      <div className="mb-5 flex gap-1 rounded-lg border border-border bg-surface p-1 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === f.id ? "bg-brand-soft text-brand" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {open.map((todo) => (
          <TodoRow key={todo.id} todo={todo} members={members} onToggle={toggleTodo} />
        ))}
      </div>

      {done.length > 0 && (
        <div className="mt-6">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Completed ({done.length})
          </p>
          <div className="space-y-1.5">
            {done.map((todo) => (
              <TodoRow key={todo.id} todo={todo} members={members} onToggle={toggleTodo} />
            ))}
          </div>
        </div>
      )}

      {todos.length === 0 && (
        <p className="pt-10 text-center text-sm text-foreground-muted">
          {allTodos.length === 0 ? "No todos yet for this task." : "No todos match this filter."}
        </p>
      )}
    </div>
  );
}

function formatDueDate(dueDate: string | null) {
  if (!dueDate) return null;
  const date = new Date(`${dueDate}T00:00:00`);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function TodoRow({
  todo,
  members,
  onToggle,
}: {
  todo: TodoItem;
  members: { id: string; name: string; initials: string; color: string }[];
  onToggle: (id: string) => void;
}) {
  const assignee = members.find((m) => m.id === todo.assigneeId);
  const dueLabel = formatDueDate(todo.dueDate);
  const isOverdue = !todo.done && !!todo.dueDate && new Date(`${todo.dueDate}T00:00:00`) < new Date(new Date().toDateString());
  return (
    <label className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => onToggle(todo.id)}
        className="h-4 w-4 rounded border-border accent-[var(--brand)]"
      />
      <span className={`flex-1 text-sm ${todo.done ? "text-foreground-muted line-through" : ""}`}>{todo.text}</span>
      {dueLabel && (
        <span className={`text-xs ${isOverdue ? "text-danger" : "text-foreground-muted"}`}>{dueLabel}</span>
      )}
      {assignee && <Avatar label={assignee.initials} color={assignee.color} size={22} />}
    </label>
  );
}
