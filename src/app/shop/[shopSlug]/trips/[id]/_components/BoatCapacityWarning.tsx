"use client";

import { useEffect, useRef, useState } from "react";
import { fill } from "@/i18n/fill";

/** Follow both form fields, including a change of boat, without blocking a save. */
export function BoatCapacityWarning({
  boats,
  initialMode,
  assignedBoatId,
  currentCapacity,
  copy,
}: {
  boats: { id: string; capacity: number }[];
  initialMode: string;
  /** The persisted assignment when this editor does not submit a boat. */
  assignedBoatId?: string | null;
  /** The persisted seats when this editor does not submit capacity. */
  currentCapacity?: number;
  copy: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [limit, setLimit] = useState<number | null>(null);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const update = () => {
      const data = new FormData(form);
      const mode = data.get("diveMode") ?? initialMode;
      const boat =
        mode === "boat"
          ? boats.find(
              (item) => item.id === (data.has("boatId") ? data.get("boatId") : assignedBoatId),
            )
          : undefined;
      const capacity = data.has("capacity") ? Number(data.get("capacity")) : (currentCapacity ?? 0);
      setLimit(boat && capacity > boat.capacity ? boat.capacity : null);
    };
    update();
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, [boats, initialMode, assignedBoatId, currentCapacity]);
  return (
    <span ref={anchor} aria-live="polite" className="text-warning">
      {limit === null ? null : fill(copy, { count: limit })}
    </span>
  );
}
