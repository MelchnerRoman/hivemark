import fs from "node:fs";
import path from "node:path";
import type { Agent } from "./types.js";

const DATA_DIR = process.env.HIVEMARK_DATA_DIR ?? path.join(import.meta.dirname, "..", "data"); // same as db.ts
const WORKSPACES_DIR = path.join(DATA_DIR, "agent-workspaces");
const ROOM_PROJECTS_DIR = path.join(DATA_DIR, "room-projects");

// Off by default — a self-hoster (or local dev) has to deliberately opt in
// server-wide before ANY agent can be granted real Bash/file access,
// regardless of the per-agent grant below. Mirrors the AUTH_ENABLED pattern.
export const TOOL_ACCESS_ENABLED = process.env.ENABLE_AGENT_TOOL_ACCESS === "1";

export const BASH_ACCESS_TOOL_ID = "bash-access";

/** True only when both the server-wide gate is on AND this specific agent
 * has been granted "bash-access". Either layer missing means text-only. */
export function hasBashAccess(agent: Agent): boolean {
  return TOOL_ACCESS_ENABLED && agent.grants.some((g) => g.toolId === BASH_ACCESS_TOOL_ID);
}

/** Ids reach here straight from URL params (Express decodes %2F), so
 * "..%2fsecret.key" would otherwise resolve into DATA_DIR itself. Every id
 * the app mints (see db.ts id()) is plain `[\w-]+`. */
function safeId(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error("invalid id");
  return id;
}

/** Per-agent, never-shared working directory for Bash/file tools to operate
 * in — created on first use. Never the app's own source/data root. */
export function getAgentWorkspaceDir(agentId: string): string {
  const dir = path.join(WORKSPACES_DIR, safeId(agentId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** One folder shared by every agent AND every human working in a Room —
 * the actual collaborative project (e.g. a website multiple agents build
 * together), as opposed to an agent's private scratch space above. */
export function getRoomProjectDir(roomId: string): string {
  const dir = path.join(ROOM_PROJECTS_DIR, safeId(roomId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export type FileEntry = { path: string; size: number; modifiedAt: string };

const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);
// An agent building a real project (npm install, git clone, ...) could
// otherwise dump tens of thousands of files here — cap it rather than let a
// list request hang or return an unbounded payload.
const MAX_LISTED_FILES = 500;

/** Recursively lists files under `dir` as POSIX-style relative paths (so
 * nested project output, not just single flat files, shows up). */
export function listFilesRecursive(dir: string): { entries: FileEntry[]; truncated: boolean } {
  const entries: FileEntry[] = [];
  let truncated = false;

  function walk(current: string, prefix: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        walk(path.join(current, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        if (entries.length >= MAX_LISTED_FILES) {
          truncated = true;
          return;
        }
        const stat = fs.statSync(path.join(current, entry.name));
        entries.push({
          path: prefix ? `${prefix}/${entry.name}` : entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  }
  walk(dir, "");
  return { entries, truncated };
}

/** Lexical containment isn't enough once `dir` can hold agent- or
 * `npm install`-created symlinks — a symlink inside `dir` can point anywhere
 * on disk while still passing a plain `path.resolve`/`startsWith` check.
 * Walks up to the nearest existing ancestor (so a not-yet-created write
 * target still validates) and checks *its* realpath is contained. */
function isReallyContained(dir: string, resolved: string): boolean {
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return false;
  const realDir = fs.realpathSync(dir);
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  return realExisting === realDir || realExisting.startsWith(realDir + path.sep);
}

/** Resolves a relative path inside `dir`, rejecting anything that escapes it
 * ("../", absolute paths, symlink tricks). Returns null if invalid, missing,
 * or not a file. */
export function resolveFileInDir(dir: string, relativePath: string): string | null {
  const resolved = path.resolve(dir, relativePath);
  if (!isReallyContained(dir, resolved)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

export type DirEntry = { name: string; type: "file" | "dir"; size: number; modifiedAt: string };

/** Lists the immediate children of `relativePath` inside `dir` (not
 * recursive — for a real folder-by-folder browser, unlike
 * listFilesRecursive's flat dump). Null if the path escapes `dir`, doesn't
 * exist, or isn't a directory. */
export function listDir(dir: string, relativePath: string): DirEntry[] | null {
  const resolved = path.resolve(dir, relativePath || ".");
  if (!isReallyContained(dir, resolved)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null;
  return fs.readdirSync(resolved, { withFileTypes: true }).map((entry) => {
    const stat = fs.statSync(path.join(resolved, entry.name));
    return {
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  });
}

/** Resolves a relative path inside `dir` for a write (create/delete/rename
 * target) — unlike resolveFileInDir, the target itself doesn't need to
 * already exist, only fall within `dir`. Null if it escapes `dir`. */
export function resolveWritePathInDir(dir: string, relativePath: string): string | null {
  if (!relativePath) return null;
  const resolved = path.resolve(dir, relativePath);
  if (!isReallyContained(dir, resolved)) return null;
  return resolved;
}

const MAX_PREVIEW_BYTES = 1024 * 1024; // 1MB — a Finder preview pane, not a text editor

export type FileContent = { content: string } | { binary: true } | { tooLarge: true };

/** Reads a file for the Finder's preview pane — refuses anything over 1MB or
 * that looks binary (null byte in the first 8KB) rather than dumping garbage
 * or a huge payload into the UI. */
export function readTextFile(dir: string, relativePath: string): FileContent | null {
  const resolved = resolveFileInDir(dir, relativePath);
  if (!resolved) return null;
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_PREVIEW_BYTES) return { tooLarge: true };
  const buffer = fs.readFileSync(resolved);
  if (buffer.subarray(0, 8000).includes(0)) return { binary: true };
  return { content: buffer.toString("utf-8") };
}
