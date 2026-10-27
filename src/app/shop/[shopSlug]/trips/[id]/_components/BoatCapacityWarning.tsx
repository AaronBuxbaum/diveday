"use client";

import { useEffect, useRef, useState } from "react";
import { fill } from "@/i18n/fill";

/** Follow both form fields, including a change of boat, without blocking a save. */
export function BoatCapacityWarning({
  boats,
  initialMode,
  copy,
}: {
  boats: { id: string; capacity: number }[];
  initialMode: string;
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
        mode === "boat" ? boats.find((item) => item.id === data.get("boatId")) : undefined;
      const capacity = Number(data.get("capacity"));
      setLimit(boat && capacity > boat.capacity ? boat.capacity : null);
    };
    update();
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, [boats, initialMode]);
  return (
    <span ref={anchor} aria-live="polite" className="text-warning">
      {limit === null ? null : fill(copy, { count: limit })}
    </span>
  );
}
