"use client";

import { useEffect, useState } from "react";
import { ChoiceRow } from "@/components/ui/form";
import { isBoatModeOn, setBoatMode } from "@/lib/boat-mode";

/**
 * **Boat mode, by hand** (ADR 20261001-logbook, decision 6): the high-contrast
 * palette on every page of this device. It left the identity menu (visual
 * review 2026-10-24, A42) and the manifest has no switch for it, so it is one
 * row here, in the hub's own row shape. A choice about this browser, so it
 * saves the moment it is ticked and needs no Save.
 */
export function BoatModeRow({ label }: { label: string }) {
  // Read after mount: the stored choice lives in this browser, and the
  // pre-paint script has already put the class on the page.
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isBoatModeOn()), []);
  return (
    <div className="flex min-h-14 items-center px-4 py-3 sm:px-5">
      <ChoiceRow
        type="checkbox"
        name="boatMode"
        checked={on}
        onChange={(event) => {
          setBoatMode(event.target.checked);
          setOn(event.target.checked);
        }}
        className="text-base font-medium"
      >
        {label}
      </ChoiceRow>
    </div>
  );
}
