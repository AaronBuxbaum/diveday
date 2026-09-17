"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * **An About row opens on the server's say-so and never closes on it.**
 *
 * Each row's `open` is decided on the server — an outcome to show, or a
 * subject with open work — and a plain `<details open={…}>` therefore *drives*
 * the element both ways. Crew found the second direction: the row opens itself
 * because nobody is assigned, the staffer assigns somebody, and
 * `updateTripCrewAction`'s `revalidatePath` re-renders the page with the row
 * now settled — so React took the attribute back off and the panel shut while
 * they were still in it, one field short of setting the job that person is
 * doing (`e2e/trips.spec.ts`'s per-trip crew role).
 *
 * The server's answer is a floor, not a state: it can only ever open the row.
 * A reader's own tap is held in `onToggle`, so a later re-render cannot undo
 * it either — the failure `GearAndSizes` documents as "a `<details>` React
 * drives to `open={false}` cannot be opened by the reader's own tap", met from
 * the other side.
 *
 * The first paint is still the server's, attribute and all, so a row that must
 * be open before JavaScript arrives (the requirements row, fail-closed) is.
 */
export function AboutRowDetails({
  id,
  open = false,
  className,
  children,
}: {
  id: string;
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(open);

  useEffect(() => {
    if (open) setIsOpen(true);
  }, [open]);

  return (
    <details
      id={id}
      open={isOpen}
      className={className}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      {children}
    </details>
  );
}
