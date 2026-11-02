"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { connectSync, exchangeAuthCode } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { RoomSidebar } from "@/components/nav/RoomSidebar";
import { TaskRoomList } from "@/components/nav/TaskRoomList";
import { TaskRoomWorkspace } from "@/components/workspace/TaskRoomWorkspace";
import { AgentsGalleryView } from "@/components/agents/AgentsGalleryView";
import { DirectMessageView } from "@/components/agents/DirectMessageView";

// Module-level so a re-run boot (StrictMode's double effect) waits for the
// same one-time code exchange instead of racing ahead without a token.
let authExchange: Promise<void> | undefined;

export default function Home() {
  const view = useStore((s) => s.view);
  const dmAgentId = useStore((s) => s.selectedDmAgentId);
  const hydrate = useStore((s) => s.hydrate);
  const loadMe = useStore((s) => s.loadMe);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }

    let disconnect: (() => void) | null = null;
    let cancelled = false;

    async function boot() {
      // Handoff from the OAuth callback redirect: a one-time code (never the
      // real session token — that stays out of the URL/history/logs) to
      // exchange for the actual bearer token.
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("authError");
      if (code || oauthError) {
        url.searchParams.delete("code");
        url.searchParams.delete("authError");
        window.history.replaceState({}, "", url.toString());
      }
      if (oauthError) setAuthError(oauthError);
      if (code) authExchange = exchangeAuthCode(code).then(({ token }) => setToken(token));
      await authExchange;

      try {
        await loadMe();
      } catch (err) {
        // fetch() rejects with a TypeError when the server is unreachable —
        // that's the "can't reach backend" screen, not a sign-in problem.
        if (err instanceof TypeError) throw err;
        setNeedsLogin(true);
        return;
      }

      await hydrate();
      // Unmounted mid-boot (e.g. StrictMode's double effect run) — don't open
      // a socket nothing will ever close.
      if (cancelled) return;
      setLoaded(true);
      disconnect = connectSync(() => {
        // Clear on success so one failed resync doesn't brick the app for good.
        hydrate().then(
          () => setError(null),
          (err) => setError(err instanceof Error ? err.message : String(err))
        );
      });
    }

    boot().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      disconnect?.();
    };
  }, [hydrate, loadMe]);

  if (needsLogin) {
    return <LoginScreen authError={authError} />;
  }

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
      {view === "dm" && <DirectMessageView key={dmAgentId} />}
      {view === "rooms" && (
        <>
          <TaskRoomList />
          <TaskRoomWorkspace />
        </>
      )}
    </div>
  );
}
