"use client";

import { ReactNode, useEffect, useRef } from "react";

const SIZE_CLASSES = {
  md: "max-w-md",
  lg: "max-w-2xl",
};

/** Native <dialog> opened with showModal(): the browser traps focus inside
 * (the page behind goes inert), closes the topmost dialog on Escape, and
 * returns focus to whatever opened it on close. */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: keyof typeof SIZE_CLASSES;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() focuses the first focusable (the ✕ button); start on the
      // first field instead, as the forms' autoFocus intended.
      dialog.querySelector<HTMLElement>("input:not([type=hidden]):not([hidden]), textarea, select")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // Fires for Escape and for our own close(); only report the former.
      // React bubbles a nested modal's close up the component tree: ignore it.
      onClose={(e) => e.target === e.currentTarget && open && onClose()}
      className={`m-auto max-h-[85vh] w-[calc(100%-2rem)] flex-col rounded-xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm open:flex ${SIZE_CLASSES[size]}`}
    >
      {open && (
        <>
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <h2 className="font-display text-base font-semibold">{title}</h2>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised hover:text-foreground"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">{children}</div>
        </>
      )}
    </dialog>
  );
}
