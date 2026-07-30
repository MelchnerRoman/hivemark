import { fileURLToPath } from "node:url";
import { repo } from "./db.js";
import { runAgentTurn } from "./claudeAgent.js";
import { notifySync } from "./events.js";

const CHECK_INTERVAL_MS = 60_000;

// ponytail: only understands "Every day at HH:MM" and "Every N minute(s)/hour(s)/day(s)" —
// any other schedule text just never fires. Upgrade to a real cron parser (e.g. node-cron)
// if users need weekday/cron-expression schedules.
export function computeNextRun(schedule: string, from: Date): Date | null {
  const daily = schedule.match(/every day at (\d{1,2}):(\d{2})/i);
  if (daily) {
    const next = new Date(from);
    next.setUTCHours(Number(daily[1]), Number(daily[2]), 0, 0);
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  const interval = schedule.match(/every (\d+) (minute|hour|day)s?/i);
  if (interval) {
    const msPerUnit = { minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;
    const unit = interval[2].toLowerCase() as keyof typeof msPerUnit;
    return new Date(from.getTime() + Number(interval[1]) * msPerUnit[unit]);
  }
  return null;
}

async function tick() {
  const now = new Date();
  for (const loop of repo.getState().loops) {
    if (!loop.active) continue;

    if (!loop.nextRun) {
      const next = computeNextRun(loop.schedule, now);
      if (next) repo.setLoopRun(loop.id, loop.lastRun, next.toISOString());
      continue;
    }
    if (new Date(loop.nextRun) > now) continue;

    const agents = repo.getAgentsForTaskRoom(loop.taskRoomId);
    for (const agent of agents) {
      runAgentTurn(agent.id, { kind: "task_room", taskRoomId: loop.taskRoomId }).catch((err) =>
        console.error("loop agent run failed", err)
      );
    }
    const next = computeNextRun(loop.schedule, now);
    repo.setLoopRun(loop.id, now.toISOString(), next ? next.toISOString() : null);
    notifySync();
  }
}

export function startScheduler() {
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
}

// Self-check: `npx tsx src/scheduler.ts`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = new Date("2026-07-30T10:00:00Z");
  console.assert(
    computeNextRun("Every day at 08:00", base)?.toISOString() === "2026-07-31T08:00:00.000Z",
    "daily schedule should roll to tomorrow when today's time already passed"
  );
  console.assert(
    computeNextRun("Every day at 12:00", base)?.toISOString() === "2026-07-30T12:00:00.000Z",
    "daily schedule should stay today when today's time hasn't passed"
  );
  console.assert(
    computeNextRun("Every 15 minutes", base)?.toISOString() === "2026-07-30T10:15:00.000Z",
    "interval schedule should add the interval"
  );
  console.assert(computeNextRun("Whenever the moon is full", base) === null, "unparsable schedule returns null");
  console.log("scheduler self-check passed");
}
