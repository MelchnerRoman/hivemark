"use client";

import { ReactNode, useEffect, useRef } from "react";

/** Off-canvas panel on the left: a native <dialog> opened with showModal(),
 * like Modal — the page behind goes inert, Escape closes it, and focus goes
 * back to the button that opened it. A click on the backdrop closes it too.
 * Children mount only while open. */
export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      // Same as Modal: only report Escape, and ignore nested modals' closes.
      onClose={(e) => e.target === e.currentTarget && open && onClose()}
      // The children fill the dialog, so a click on the dialog itself is the backdrop.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-0 h-dvh max-h-none max-w-[85vw] border-0 bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40 open:flex"
    >
      {open && children}
    </dialog>
  );
}
