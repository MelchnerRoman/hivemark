import { fileURLToPath } from "node:url";
import { CronExpressionParser } from "cron-parser";
import { repo } from "./db.js";
import { runAgentTurn } from "./claudeAgent.js";
import { notifySync } from "./events.js";

const CHECK_INTERVAL_MS = 60_000;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Understands "Every day at HH:MM", "Every N minute(s)/hour(s)/day(s)", "Every
 * <Weekday> at HH:MM", and — for anything else — falls back to treating the
 * whole string as a real cron expression via `cron-parser`, so typing a raw
 * cron string (e.g. "0 9 * * 1-5") also works for schedules the friendly
 * phrasings don't cover.
 */
export function computeNextRun(schedule: string, from: Date): Date | null {
  const daily = schedule.match(/every day at (\d{1,2}):(\d{2})/i);
  if (daily) {
    const next = new Date(from);
    next.setUTCHours(Number(daily[1]), Number(daily[2]), 0, 0);
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  const weekly = schedule.match(/every (sunday|monday|tuesday|wednesday|thursday|friday|saturday) at (\d{1,2}):(\d{2})/i);
  if (weekly) {
    const targetDay = WEEKDAYS.indexOf(weekly[1].toLowerCase());
    const next = new Date(from);
    next.setUTCHours(Number(weekly[2]), Number(weekly[3]), 0, 0);
    let daysUntilTarget = (targetDay - next.getUTCDay() + 7) % 7;
    if (daysUntilTarget === 0 && next <= from) daysUntilTarget = 7;
    next.setUTCDate(next.getUTCDate() + daysUntilTarget);
    return next;
  }
  const interval = schedule.match(/every (\d+)? ?(minute|hour|day)s?/i);
  if (interval) {
    const msPerUnit = { minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;
    const unit = interval[2].toLowerCase() as keyof typeof msPerUnit;
    const count = interval[1] ? Number(interval[1]) : 1;
    return new Date(from.getTime() + count * msPerUnit[unit]);
  }
  try {
    return CronExpressionParser.parse(schedule, { currentDate: from, tz: "UTC" }).next().toDate();
  } catch {
    return null;
  }
}

async function tick() {
  const now = new Date();
  for (const loop of repo.getActiveLoops()) {
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
    // Fire-and-forget above (a loop firing hourly shouldn't block on however long the
    // agent takes), so the outcome we can honestly record here is who got triggered —
    // not whether their turn ultimately succeeded.
    const outcome =
      agents.length === 0
        ? "No agents in this Task Room"
        : `Triggered ${agents.length} agent${agents.length === 1 ? "" : "s"}`;
    repo.recordLoopRun(loop.id, now.toISOString(), outcome);

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
  console.assert(
    computeNextRun("Every hour", base)?.toISOString() === "2026-07-30T11:00:00.000Z",
    "interval schedule without a number should default to 1"
  );
  console.assert(
    computeNextRun("Every 7 days", base)?.toISOString() === "2026-08-06T10:00:00.000Z",
    "multi-day interval schedule should add N days"
  );
  console.assert(computeNextRun("Whenever the moon is full", base) === null, "unparsable schedule returns null");
  console.assert(
    computeNextRun("Every Monday at 09:00", base)?.toISOString() === "2026-08-03T09:00:00.000Z",
    "weekly schedule should roll to the next occurrence of that weekday"
  );
  console.assert(
    computeNextRun("Every Thursday at 08:00", base)?.toISOString() === "2026-08-06T08:00:00.000Z",
    "weekly schedule on today's weekday should roll a full week when today's time already passed"
  );
  console.assert(
    computeNextRun("Every Thursday at 12:00", base)?.toISOString() === "2026-07-30T12:00:00.000Z",
    "weekly schedule on today's weekday should stay today when today's time hasn't passed"
  );
  console.assert(
    computeNextRun("0 9 * * 1", base)?.toISOString() === "2026-08-03T09:00:00.000Z",
    "raw cron expression should be parsed for real via cron-parser"
  );
  console.log("scheduler self-check passed");
}
