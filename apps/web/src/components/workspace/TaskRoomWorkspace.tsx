"use client";

import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import type { WorkspaceTab } from "@/lib/types";
import { ChatPane } from "./ChatPane";
import { WorkflowsPanel } from "./WorkflowsPanel";
import { LoopsPanel } from "./LoopsPanel";
import { TodosPanel } from "./TodosPanel";
import { AgentsPanel } from "./AgentsPanel";
import { FilesPanel } from "./FilesPanel";
import { PreviewPanel } from "./PreviewPanel";

const TABS: { id: WorkspaceTab; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "workflows", label: "Workflows", icon: "🔀" },
  { id: "loops", label: "Loops", icon: "🔁" },
  { id: "todos", label: "Todos", icon: "☑️" },
  { id: "agents", label: "Agents", icon: "🤖" },
  { id: "files", label: "Files", icon: "📁" },
  { id: "preview", label: "Preview", icon: "🌐" },
];

const statusTone: Record<string, "neutral" | "brand" | "accent"> = {
  open: "neutral",
  in_progress: "brand",
  done: "accent",
};

const statusLabel: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

export function TaskRoomWorkspace() {
  const taskRoom = useStore((s) => s.taskRooms.find((t) => t.id === s.selectedTaskRoomId));
  const members = useStore((s) => s.members);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const agents = useStore((s) => s.agents);
  const workflows = useStore((s) => s.workflows);
  const loops = useStore((s) => s.loops);
  const todos = useStore((s) => s.todos);

  if (!taskRoom) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
        Select a Task Room, or create one, to open its workspace.
      </div>
    );
  }

  const assignees = members.filter((m) => taskRoom.memberIds.includes(m.id));
  const taskWorkflows = workflows.filter((w) => w.taskRoomId === taskRoom.id);
  const taskLoops = loops.filter((l) => l.taskRoomId === taskRoom.id);
  const taskTodos = todos.filter((t) => t.taskRoomId === taskRoom.id);

  const counts: Record<WorkspaceTab, number | null> = {
    chat: null,
    workflows: taskWorkflows.length || null,
    loops: taskLoops.length || null,
    todos: taskTodos.filter((t) => !t.done).length || null,
    agents: agents.length || null,
    files: null,
    preview: null,
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold">
              {taskRoom.emoji} {taskRoom.name}
            </h2>
            <Badge tone={statusTone[taskRoom.status]}>{statusLabel[taskRoom.status]}</Badge>
          </div>
          <div className="mt-1.5 flex -space-x-1.5">
            {assignees.map((m) => (
              <Avatar key={m.id} label={m.initials} color={m.color} size={22} />
            ))}
          </div>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-border px-4 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-brand text-brand"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
            {counts[tab.id] != null && (
              <span className="ml-0.5 rounded-full bg-surface-raised px-1.5 text-xs text-foreground-muted">
                {counts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1">
        {activeTab === "chat" && <ChatPane taskRoomId={taskRoom.id} />}
        {activeTab === "workflows" && <WorkflowsPanel taskRoomId={taskRoom.id} />}
        {activeTab === "loops" && <LoopsPanel taskRoomId={taskRoom.id} />}
        {activeTab === "todos" && <TodosPanel taskRoomId={taskRoom.id} />}
        {activeTab === "agents" && <AgentsPanel taskRoomId={taskRoom.id} />}
        {activeTab === "files" && <FilesPanel roomId={taskRoom.roomId} />}
        {activeTab === "preview" && <PreviewPanel roomId={taskRoom.roomId} />}
      </div>
    </div>
  );
}
