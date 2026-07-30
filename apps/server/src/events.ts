import { EventEmitter } from "node:events";

/** Fired whenever server state changes; the WS layer listens and pushes a
 * `{type:"sync"}` ping to every connected client, which then refetches
 * GET /api/state. Simple full-refresh model — fine at this data scale. */
export const bus = new EventEmitter();

export function notifySync() {
  bus.emit("sync");
}
