"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { CloseIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

type DrawerProps = {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
};

export function Drawer({ children, description, onClose, open, title }: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className="m-0 ml-auto h-dvh w-full max-w-xl border-0 bg-transparent p-0 backdrop:bg-transparent"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      <div className="flex h-full flex-col border-l border-[var(--line)] bg-[var(--surface)] shadow-[-18px_0_45px_rgb(19_33_45/0.14)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-5 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]" id={titleId}>{title}</h2>
            {description ? <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]" id={descriptionId}>{description}</p> : null}
          </div>
          <Button aria-label="Close panel" onClick={onClose} size="icon" variant="ghost"><CloseIcon className="size-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">{children}</div>
      </div>
    </dialog>
  );
}
