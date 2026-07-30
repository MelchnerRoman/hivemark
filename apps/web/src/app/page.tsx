"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { connectSync } from "@/lib/api";
import { RoomSidebar } from "@/components/nav/RoomSidebar";
import { TaskRoomList } from "@/components/nav/TaskRoomList";
import { TaskRoomWorkspace } from "@/components/workspace/TaskRoomWorkspace";
import { AgentsGalleryView } from "@/components/agents/AgentsGalleryView";
import { DirectMessageView } from "@/components/agents/DirectMessageView";

export default function Home() {
  const view = useStore((s) => s.view);
  const hydrate = useStore((s) => s.hydrate);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    hydrate()
      .then(() => setLoaded(true))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    const disconnect = connectSync(() => {
      hydrate().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    });
    return disconnect;
  }, [hydrate]);

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background p-8 text-center text-foreground">
        <div>
          <p className="font-display text-lg font-semibold">Can&apos;t reach the Hivemark backend</p>
          <p className="mt-2 text-sm text-foreground-muted">{error}</p>
          <p className="mt-2 text-sm text-foreground-muted">
            Make sure the server is running (<code>npm run dev</code> in <code>apps/server</code>) on
            localhost:4001.
          </p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="flex h-screen w-full items-center justify-center bg-background text-foreground-muted">Loading…</div>;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <RoomSidebar />
      {view === "agents" && <AgentsGalleryView />}
      {view === "dm" && <DirectMessageView />}
      {view === "rooms" && (
        <>
          <TaskRoomList />
          <TaskRoomWorkspace />
        </>
      )}
    </div>
  );
}
