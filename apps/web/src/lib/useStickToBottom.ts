import { useLayoutEffect, useRef } from "react";

/** Keeps a chat scroller pinned to the newest message: opens at the bottom,
 * and follows new messages only while the user is already near the bottom
 * (so reading older history isn't yanked away). `resetKey` = conversation id;
 * `footer` = anything else at the bottom (e.g. a "working…" row). */
export function useStickToBottom(messages: unknown, resetKey: string, footer?: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    pinned.current = true;
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, resetKey, footer]);

  function onScroll() {
    const el = ref.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  return { ref, onScroll };
}
