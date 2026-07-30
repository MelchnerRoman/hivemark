"use client";

import { FormEvent, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Loop } from "@/lib/types";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const MOCK_OUTCOMES = [
  "OK",
  "OK",
  "3 events found",
  "1 event found",
  "No changes",
  "5 events found",
  "Skipped — no new data",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic mock run history — not persisted, just derived from the loop id so it's stable across renders. */
function mockRunHistory(loop: Loop): { timestamp: string; outcome: string }[] {
  const base = loop.lastRun ? new Date(loop.lastRun).getTime() : Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return [0, 1, 2].map((i) => {
    const seed = hashString(`${loop.id}-run-${i}`);
    const outcome = MOCK_OUTCOMES[seed % MOCK_OUTCOMES.length];
    const timestamp = new Date(base - i * dayMs).toISOString();
    return { timestamp, outcome };
  });
}

export function LoopsPanel({ taskRoomId }: { taskRoomId: string }) {
  const loops = useStore(useShallow((s) => s.loops.filter((l) => l.taskRoomId === taskRoomId)));
  const createLoop = useStore((s) => s.createLoop);
  const toggleLoopActive = useStore((s) => s.toggleLoopActive);
  const removeLoop = useStore((s) => s.removeLoop);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("Every day at 09:00");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createLoop(taskRoomId, name.trim(), schedule);
    setName("");
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
          <option>Every Monday at 09:00</option>
        </select>
        <Button type="submit" disabled={!name.trim()}>
          Create loop
        </Button>
      </form>

      <div className="space-y-3">
        {loops.map((loop) => {
          const history = mockRunHistory(loop);
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

              <div className="mt-3 border-t border-border pt-2">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  Recent runs
                </p>
                <ul className="space-y-1">
                  {history.map((run, i) => (
                    <li key={i} className="flex items-center justify-between text-xs text-foreground-muted">
                      <span>{formatDate(run.timestamp)}</span>
                      <span
                        className={run.outcome === "OK" ? "text-accent" : "text-foreground-muted"}
                      >
                        {run.outcome}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
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
