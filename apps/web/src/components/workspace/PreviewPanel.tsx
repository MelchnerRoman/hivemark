"use client";

import { useEffect, useRef, useState } from "react";
import { getPreviewStatus, resolvePreviewUrl, startRoomPreview, stopRoomPreview } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { PreviewState } from "@/lib/types";

const statusTone: Record<PreviewState["status"], "neutral" | "brand" | "danger" | "accent"> = {
  stopped: "neutral",
  starting: "brand",
  running: "accent",
  error: "danger",
};

export function PreviewPanel({ roomId }: { roomId: string }) {
  const [state, setState] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refresh() {
    getPreviewStatus(roomId)
      .then(setState)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(() => {
    refresh();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // While a node dev server is starting, poll until it's running or errors —
  // static mode is always "running" already, no polling needed.
  useEffect(() => {
    if (state?.status === "starting") {
      pollTimer.current = setTimeout(refresh, 1500);
    }
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function handleStart() {
    setError(null);
    try {
      setState(await startRoomPreview(roomId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStop() {
    setState(await stopRoomPreview(roomId));
  }

  if (!state) {
    return <div className="p-6 text-sm text-foreground-muted">{error ?? "Loading…"}</div>;
  }

  if (state.mode === "none") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-foreground-muted">
        Nothing to run yet — add a root <code>index.html</code>, or a{" "}
        <code>package.json</code> with a &quot;dev&quot; or &quot;start&quot; script, to this room&apos;s project
        folder (see the Files tab).
      </div>
    );
  }

  const url = state.url ? resolvePreviewUrl(state.url) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[state.status]}>{state.status}</Badge>
          <span className="text-xs text-foreground-muted">
            {state.mode === "static" ? "Static site" : "Live dev server"}
          </span>
        </div>
        <div className="flex gap-2">
          {state.mode === "node" && state.status !== "running" && state.status !== "starting" && (
            <Button className="text-xs" onClick={handleStart}>
              Start
            </Button>
          )}
          {state.mode === "node" && (state.status === "running" || state.status === "starting") && (
            <Button variant="secondary" className="text-xs" onClick={handleStop}>
              Stop
            </Button>
          )}
          <Button variant="secondary" className="text-xs" onClick={refresh}>
            Refresh
          </Button>
          {url && (
            <Button variant="secondary" className="text-xs" onClick={() => window.open(url, "_blank")}>
              Open externally
            </Button>
          )}
        </div>
      </div>

      {error && <p className="px-6 py-2 text-sm text-danger">{error}</p>}

      {state.logTail.length > 0 && (
        <pre className="max-h-40 overflow-auto border-b border-border bg-surface-raised px-6 py-2 text-xs text-foreground-muted">
          {state.logTail.join("\n")}
        </pre>
      )}

      {url ? (
        <iframe src={url} className="min-h-0 flex-1 border-0" title="Room preview" />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
          {state.status === "starting" ? "Starting…" : "Not running."}
        </div>
      )}
    </div>
  );
}
