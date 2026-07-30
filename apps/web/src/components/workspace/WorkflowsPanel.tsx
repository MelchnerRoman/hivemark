"use client";

import { FormEvent, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const statusTone: Record<string, "neutral" | "brand" | "accent"> = {
  draft: "neutral",
  running: "brand",
  done: "accent",
};

export function WorkflowsPanel({ taskRoomId }: { taskRoomId: string }) {
  const workflows = useStore(useShallow((s) => s.workflows.filter((w) => w.taskRoomId === taskRoomId)));
  const createWorkflow = useStore((s) => s.createWorkflow);
  const toggleWorkflowStep = useStore((s) => s.toggleWorkflowStep);
  const addWorkflowStep = useStore((s) => s.addWorkflowStep);
  const markWorkflowDone = useStore((s) => s.markWorkflowDone);
  const removeWorkflow = useStore((s) => s.removeWorkflow);
  const [name, setName] = useState("");
  const [stepDraft, setStepDraft] = useState<Record<string, string>>({});

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createWorkflow(taskRoomId, name.trim(), "");
    setName("");
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <form onSubmit={handleCreate} className="mb-5 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New workflow name…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <Button type="submit" disabled={!name.trim()}>
          Create workflow
        </Button>
      </form>

      <div className="space-y-4">
        {workflows.map((w) => {
          const doneCount = w.steps.filter((s) => s.done).length;
          const pct = w.steps.length > 0 ? Math.round((doneCount / w.steps.length) * 100) : 0;
          const canMarkDone = w.status !== "done";
          return (
            <div key={w.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold">{w.name}</h3>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone[w.status]}>{w.status}</Badge>
                  {canMarkDone && (
                    <button
                      onClick={() => markWorkflowDone(w.id)}
                      className="text-xs text-foreground-muted hover:text-accent"
                    >
                      Mark complete
                    </button>
                  )}
                  <button
                    onClick={() => removeWorkflow(w.id)}
                    className="text-xs text-foreground-muted hover:text-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {w.description && <p className="mb-2 text-sm text-foreground-muted">{w.description}</p>}
              <p className="mb-1 text-xs text-foreground-muted">
                {doneCount}/{w.steps.length} steps complete
              </p>
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                <div
                  className={`h-full rounded-full transition-all ${w.status === "done" ? "bg-accent" : "bg-brand"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <ul className="space-y-1.5">
                {w.steps.map((step) => (
                  <li key={step.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={step.done}
                        onChange={() => toggleWorkflowStep(w.id, step.id)}
                        className="h-4 w-4 rounded border-border accent-[var(--brand)]"
                      />
                      <span className={step.done ? "text-foreground-muted line-through" : ""}>{step.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = stepDraft[w.id]?.trim();
                  if (!v) return;
                  addWorkflowStep(w.id, v);
                  setStepDraft((s) => ({ ...s, [w.id]: "" }));
                }}
                className="mt-2 flex gap-2"
              >
                <input
                  value={stepDraft[w.id] ?? ""}
                  onChange={(e) => setStepDraft((s) => ({ ...s, [w.id]: e.target.value }))}
                  placeholder="Add step…"
                  className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                />
                <Button type="submit" variant="secondary" className="text-xs">
                  Add
                </Button>
              </form>
            </div>
          );
        })}

        {workflows.length === 0 && (
          <p className="pt-10 text-center text-sm text-foreground-muted">
            No workflows yet. Break this task into ordered steps that people or agents can run.
          </p>
        )}
      </div>
    </div>
  );
}
