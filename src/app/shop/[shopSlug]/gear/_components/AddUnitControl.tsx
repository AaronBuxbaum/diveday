"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/layer";

/** The one add door and sheet, composed at whichever register location is active. */
export function AddUnitControl({
  className,
  initialOpen,
  title,
  children,
}: {
  className?: string;
  /** Server-decided: a refusal from this form to show. */
  initialOpen: boolean;
  title: string;
  /** Server-rendered form slot. */
  children: React.ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => setHydrated(true), []);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        // Publish readiness for browser journeys; before hydration the painted
        // button has no handler attached.
        data-hydrated={hydrated ? "true" : undefined}
      >
        {title}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} className="max-w-xl">
        <div
          id="add-unit"
          className="-mx-1 max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain px-1 pb-1"
        >
          {children}
        </div>
      </Dialog>
    </>
  );
}
