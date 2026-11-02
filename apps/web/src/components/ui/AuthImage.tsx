"use client";

import { useEffect, useState } from "react";
import { fetchRoomFileBlob } from "@/lib/api";

/** A Room project file as an <img>, fetched with the session token (project
 * files, chat uploads included, are members-only). The object URL is only
 * ever used as an <img> source — never opened as a page, since an SVG
 * document there would run script on the app's own origin. */
export function AuthImage({ roomId, path, className }: { roomId: string; path: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchRoomFileBlob(roomId, path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [roomId, path]);

  if (failed) {
    // Deleted file, lost access, backend down: say so instead of pulsing forever.
    return <div className={`flex items-center justify-center bg-surface-raised p-3 text-xs text-foreground-muted ${className ?? ""}`}>Couldn&apos;t load {path.split("/").pop()}</div>;
  }
  if (!src) return <div className={`animate-pulse bg-surface-raised ${className ?? ""}`} style={{ minHeight: 64, minWidth: 96 }} />;
  // eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer
  return <img src={src} alt={path} className={className} />;
}
