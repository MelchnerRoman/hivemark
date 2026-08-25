"use client";

import { FormEvent, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function LoopsPanel({ taskRoomId }: { taskRoomId: string }) {
  const loops = useStore(useShallow((s) => s.loops.filter((l) => l.taskRoomId === taskRoomId)));
  const createLoop = useStore((s) => s.createLoop);
  const toggleLoopActive = useStore((s) => s.toggleLoopActive);
  const removeLoop = useStore((s) => s.removeLoop);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("Every day at 09:00");
  const [customSchedule, setCustomSchedule] = useState("");
  const isCustom = schedule === "custom";

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const finalSchedule = isCustom ? customSchedule.trim() : schedule;
    if (!name.trim() || !finalSchedule) return;
    createLoop(taskRoomId, name.trim(), finalSchedule);
    setName("");
    setCustomSchedule("");
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <form onSubmit={handleCreate} className="mb-5 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New loop name…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <select
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option>Every 15 minutes</option>
          <option>Every hour</option>
          <option>Every day at 09:00</option>
          <option>Every 7 days</option>
          <option>Every Monday at 09:00</option>
          <option value="custom">Custom (cron expression)…</option>
        </select>
        {isCustom && (
          <input
            value={customSchedule}
            onChange={(e) => setCustomSchedule(e.target.value)}
            placeholder="e.g. 0 9 * * 1-5"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-brand"
          />
        )}
        <Button type="submit" disabled={!name.trim() || (isCustom && !customSchedule.trim())}>
          Create loop
        </Button>
      </form>

      <div className="space-y-3">
        {loops.map((loop) => {
          return (
            <div key={loop.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-sm font-semibold">{loop.name}</h3>
                    <Badge tone={loop.active ? "accent" : "neutral"}>{loop.active ? "Active" : "Paused"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-foreground-muted">{loop.schedule}</p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Last run {formatDate(loop.lastRun)} · Next run {formatDate(loop.nextRun)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => toggleLoopActive(loop.id)}>
                    {loop.active ? "Pause" : "Resume"}
                  </Button>
                  <button
                    onClick={() => removeLoop(loop.id)}
                    className="text-xs text-foreground-muted hover:text-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {loop.runs.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                    Recent runs
                  </p>
                  <ul className="space-y-1">
                    {loop.runs.map((run, i) => (
                      <li key={i} className="flex items-center justify-between text-xs text-foreground-muted">
                        <span>{formatDate(run.timestamp)}</span>
                        <span>{run.outcome}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}

        {loops.length === 0 && (
          <p className="pt-10 text-center text-sm text-foreground-muted">
            No loops yet. Set up a recurring automated run for this task.
          </p>
        )}
      </div>
    </div>
  );
}
