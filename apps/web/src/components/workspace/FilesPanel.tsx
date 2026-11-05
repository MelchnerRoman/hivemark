"use client";

import { ChangeEvent, SyntheticEvent, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  createRoomFile,
  deleteRoomFile,
  downloadAgentFile,
  downloadRoomFile,
  getRoomFileContent,
  isImagePath,
  listAgentFiles,
  listRoomFiles,
  renameRoomFile,
  uploadRoomFile,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { AuthImage } from "@/components/ui/AuthImage";
import type { DirEntry, FileContent, SharedFile } from "@/lib/types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** What the inline strip above the listing is asking for. */
type Ask =
  | { kind: "dir" | "file" }
  | { kind: "rename" | "delete"; entry: DirEntry }
  | { kind: "replace"; files: File[]; clashes: string[] };
/** [name field label, submit button] per Ask kind. */
const ASK_TEXT: Record<Ask["kind"], [string, string]> = {
  dir: ["New folder name", "Create folder"],
  file: ["New file name", "Create file"],
  rename: ["Rename to", "Rename"],
  delete: ["", "Delete"],
  replace: ["", "Replace"],
};

/** The real Finder — folder-by-folder navigation over a Room's shared
 * project, the collaborative workspace every agent (and human) in the Room
 * reads and writes together. */
function ProjectFinder({ roomId }: { roomId: string }) {
  const [currentDir, setCurrentDir] = useState("");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askName, setAskName] = useState("");

  function refresh() {
    listRoomFiles(roomId, currentDir)
      .then((list) => {
        setEntries(list);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(refresh, [roomId, currentDir]);

  /** Runs a mutation, then refreshes — or surfaces its error (refresh() would
   * otherwise clear it right away). */
  async function run(action: Promise<unknown>) {
    try {
      await action;
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openEntry(entry: DirEntry) {
    const path = joinPath(currentDir, entry.name);
    if (entry.type === "dir") {
      setCurrentDir(path);
      setPreviewPath(null);
      setPreviewContent(null);
    } else {
      setPreviewPath(path);
      setPreviewContent(null);
      getRoomFileContent(roomId, path)
        .then(setPreviewContent)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }

  function askFor(next: Ask) {
    setAsk(next);
    setAskName(next.kind === "rename" ? next.entry.name : "");
  }

  function upload(files: File[]) {
    // overwrite: only new names, or ones the user just confirmed replacing, remain.
    return run(
      (async () => {
        for (const file of files) await uploadRoomFile(roomId, joinPath(currentDir, file.name), file, true);
      })()
    );
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    // The server refuses to overwrite unless told to — ask first.
    const clashes = files.filter((file) => entries?.some((x) => x.name === file.name)).map((f) => f.name);
    if (clashes.length) askFor({ kind: "replace", files, clashes });
    else await upload(files);
  }

  async function handleAsk(e: SyntheticEvent, skipClashes = false) {
    e.preventDefault();
    if (!ask) return;
    const name = askName.trim();
    setAsk(null);
    if (ask.kind === "replace") {
      await upload(skipClashes ? ask.files.filter((f) => !ask.clashes.includes(f.name)) : ask.files);
    } else if (ask.kind === "delete") {
      const path = joinPath(currentDir, ask.entry.name);
      await run(deleteRoomFile(roomId, path));
      if (previewPath === path) {
        setPreviewPath(null);
        setPreviewContent(null);
      }
    } else if (ask.kind === "rename") {
      if (name && name !== ask.entry.name) {
        await run(renameRoomFile(roomId, joinPath(currentDir, ask.entry.name), joinPath(currentDir, name)));
      }
    } else if (name) {
      await run(createRoomFile(roomId, joinPath(currentDir, name), ask.kind));
    }
  }

  /** Inline replacement for prompt()/confirm(): a name field or a yes/no. */
  function askStrip() {
    if (!ask) return null;
    const danger = ask.kind === "delete" || ask.kind === "replace";
    return (
      <form
        onSubmit={handleAsk}
        className={`mt-2 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          danger ? "border-danger/30 bg-danger-soft text-danger" : "border-border bg-surface-raised"
        }`}
      >
        {ask.kind === "delete" && <span className="mr-auto">Delete &quot;{ask.entry.name}&quot;? This can&apos;t be undone.</span>}
        {ask.kind === "replace" && (
          <span className="mr-auto">Replace existing {ask.clashes.map((n) => `"${n}"`).join(", ")}?</span>
        )}
        {!danger && (
          <input
            autoFocus
            aria-label={ASK_TEXT[ask.kind][0]}
            placeholder={ASK_TEXT[ask.kind][0]}
            value={askName}
            onChange={(e) => setAskName(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        )}
        <Button type="button" variant="ghost" onClick={() => setAsk(null)}>
          Cancel
        </Button>
        {ask.kind === "replace" && ask.clashes.length < ask.files.length && (
          <Button type="button" variant="secondary" onClick={(e) => handleAsk(e, true)}>
            Skip existing
          </Button>
        )}
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={!danger && !askName.trim()}>
          {ASK_TEXT[ask.kind][1]}
        </Button>
      </form>
    );
  }

  const crumbs = currentDir ? currentDir.split("/") : [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => setCurrentDir("")} className="text-brand hover:underline">
            Project
          </button>
          {crumbs.map((segment, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-foreground-muted">/</span>
              <button
                onClick={() => setCurrentDir(crumbs.slice(0, i + 1).join("/"))}
                className="text-brand hover:underline"
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input ref={uploadInput} type="file" multiple hidden onChange={handleUpload} />
          <Button variant="secondary" className="text-xs" onClick={() => uploadInput.current?.click()}>
            Upload
          </Button>
          <Button variant="secondary" className="text-xs" onClick={() => askFor({ kind: "dir" })}>
            New folder
          </Button>
          <Button variant="secondary" className="text-xs" onClick={() => askFor({ kind: "file" })}>
            New file
          </Button>
          <Button variant="secondary" className="text-xs" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>

      {ask && !("entry" in ask) && <div className="mb-3">{askStrip()}</div>}
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      <div className="space-y-1">
        {entries?.length === 0 && <p className="py-6 text-center text-sm text-foreground-muted">Empty folder.</p>}
        {entries?.map((entry) => (
          <div key={entry.name} className="rounded-lg border border-border bg-surface px-3 py-2">
            <div className="flex items-center justify-between">
              <button onClick={() => openEntry(entry)} className="flex flex-1 items-center gap-2 text-left text-sm">
                <span>{entry.type === "dir" ? "📁" : "📄"}</span>
                <span className="font-medium">{entry.name}</span>
                {entry.type === "file" && (
                  <span className="text-xs text-foreground-muted">{formatSize(entry.size)}</span>
                )}
              </button>
              <div className="flex gap-1 text-xs">
                {entry.type === "file" && (
                  <button
                    onClick={() => downloadRoomFile(roomId, joinPath(currentDir, entry.name))}
                    className="text-foreground-muted hover:text-brand"
                  >
                    Download
                  </button>
                )}
                <button onClick={() => askFor({ kind: "rename", entry })} className="text-foreground-muted hover:text-brand">
                  Rename
                </button>
                <button onClick={() => askFor({ kind: "delete", entry })} className="text-foreground-muted hover:text-danger">
                  Delete
                </button>
              </div>
            </div>
          {ask && "entry" in ask && ask.entry.name === entry.name && askStrip()}
          </div>
        ))}
      </div>

      {previewPath && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{previewPath}</p>
            <button
              onClick={() => {
                setPreviewPath(null);
                setPreviewContent(null);
              }}
              className="text-xs text-foreground-muted hover:text-foreground"
            >
              Close
            </button>
          </div>
          {isImagePath(previewPath) ? (
            <AuthImage roomId={roomId} path={previewPath} className="max-h-96 rounded-lg" />
          ) : (
            previewContent === null && <p className="text-xs text-foreground-muted">Loading…</p>
          )}
          {previewContent && "content" in previewContent && !isImagePath(previewPath) && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
              {previewContent.content}
            </pre>
          )}
          {previewContent && "binary" in previewContent && !isImagePath(previewPath) && (
            <p className="text-xs text-foreground-muted">Binary file — download to view.</p>
          )}
          {previewContent && "tooLarge" in previewContent && (
            <p className="text-xs text-foreground-muted">File too large to preview — download to view.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentFiles({ agentId, title, dm = false }: { agentId: string; title: string; dm?: boolean }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<SharedFile[] | null>(null);

  function toggle() {
    if (!open && files === null) {
      listAgentFiles(agentId, dm).then((listing) => setFiles(listing.files));
    }
    setOpen(!open);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <button onClick={toggle} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-foreground-muted">{open ? "Hide" : "Show files"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {files === null && <p className="text-xs text-foreground-muted">Loading…</p>}
          {files?.length === 0 && <p className="text-xs text-foreground-muted">No files yet.</p>}
          {files?.map((file) => (
            <div
              key={file.path}
              className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2"
            >
              <div>
                <p className="text-sm">{file.path}</p>
                <p className="text-xs text-foreground-muted">
                  {formatSize(file.size)} · {new Date(file.modifiedAt).toLocaleString()}
                </p>
              </div>
              <Button variant="secondary" className="text-xs" onClick={() => downloadAgentFile(agentId, file.path, dm)}>
                Download
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilesPanel({ roomId }: { roomId: string }) {
  const agents = useStore((s) => s.agents);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <p className="mb-4 text-sm text-foreground-muted">
        Every agent (and you) working in this room shares the same project folder below — grant an agent the
        &quot;Files&quot; tool to let it read and write here too.
      </p>

      <ProjectFinder roomId={roomId} />

      <h3 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        Private (per agent)
      </h3>
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentFiles key={agent.id} agentId={agent.id} title={`${agent.name}'s private workspace`} />
        ))}
        {agents.length === 0 && <p className="text-sm text-foreground-muted">No agents yet.</p>}
      </div>
    </div>
  );
}
