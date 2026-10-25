// i18n-exempt-file: the title arrives as an already-translated prop.
"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";

const OPEN_EVENT = "gear:open-add-unit";

/**
 * **Add a unit opens as a sheet over the register** (visual review A48): the
 * header's door (or the empty register's) opens the form in a dialog with its
 * first field focused, instead of unfolding a band at the foot of a long list.
 * It opens itself on a refusal from its own form (`initialOpen`), so the
 * field's error and what was typed are where the person left them.
 */
export function AddUnitSheet({
  initialOpen,
  title,
  children,
}: {
  /** Server-decided: a refusal from this form to show. */
  initialOpen: boolean;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, openIt);
    return () => window.removeEventListener(OPEN_EVENT, openIt);
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={title} className="max-w-xl">
      <div id="add-unit" className="max-h-[70vh] overflow-y-auto">
        {children}
      </div>
    </Modal>
  );
}

export function openAddUnitSheet() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
