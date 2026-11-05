import type { Agent, TaskRoomStatus } from "./types";

export const AGENT_STATUS_TONE: Record<Agent["status"], "neutral" | "brand" | "danger"> = {
  idle: "neutral",
  running: "brand",
  error: "danger",
};

export const TASK_ROOM_STATUS_TONE: Record<TaskRoomStatus, "neutral" | "brand" | "accent"> = {
  open: "neutral",
  in_progress: "brand",
  done: "accent",
};

export const TASK_ROOM_STATUS_LABEL: Record<TaskRoomStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** An attachment's file name without the upload's `${Date.now()}-` prefix (ChatPane). */
export function attachmentName(path: string) {
  return path.split("/").pop()!.replace(/^\d{13}-/, "");
}
