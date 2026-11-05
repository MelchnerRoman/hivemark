"use client";

import { useStore } from "@/lib/store";
import { TASK_ROOM_STATUS_LABEL, TASK_ROOM_STATUS_TONE } from "@/lib/display";
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

/** `onOpenTaskList`: below lg the Task Room list is a drawer, opened from here. */
export function TaskRoomWorkspace({ taskListOpen, onOpenTaskList }: { taskListOpen: boolean; onOpenTaskList: () => void }) {
  const taskRoom = useStore((s) => s.taskRooms.find((t) => t.id === s.selectedTaskRoomId));
  const members = useStore((s) => s.members);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const agents = useStore((s) => s.agents);
  const workflows = useStore((s) => s.workflows);
  const loops = useStore((s) => s.loops);
  const todos = useStore((s) => s.todos);

  const taskListButton = (
    <button
      onClick={onOpenTaskList}
      aria-label="Show Task Rooms"
      aria-haspopup="dialog"
      aria-expanded={taskListOpen}
      title="Task Rooms"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground lg:hidden"
    >
      🗂️
    </button>
  );

  if (!taskRoom) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-foreground-muted">
        Select a Task Room, or create one, to open its workspace.
        {taskListButton}
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
    <div className="@container flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-4 md:px-6">
        {taskListButton}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-base font-semibold">
              {taskRoom.emoji} {taskRoom.name}
            </h2>
            <Badge tone={TASK_ROOM_STATUS_TONE[taskRoom.status]}>{TASK_ROOM_STATUS_LABEL[taskRoom.status]}</Badge>
          </div>
          <div className="mt-1.5 flex -space-x-1.5">
            {assignees.map((m) => (
              <Avatar key={m.id} label={m.initials} color={m.color} size={22} />
            ))}
          </div>
        </div>
      </header>

      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg px-2.5 py-2 @3xl:px-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-brand text-brand"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <span aria-hidden>{tab.icon}</span>
            {/* Icons only while the workspace is too narrow for all seven labels. */}
            <span className="sr-only @3xl:not-sr-only">{tab.label}</span>
            {counts[tab.id] != null && (
              <span className="ml-0.5 rounded-full bg-surface-raised px-1.5 text-xs text-foreground-muted">
                {counts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Keyed so per-panel local state (chat draft, pending attachments, todo
          assignee…) doesn't leak into the next Task Room. */}
      <div key={taskRoom.id} className="min-h-0 flex-1">
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
