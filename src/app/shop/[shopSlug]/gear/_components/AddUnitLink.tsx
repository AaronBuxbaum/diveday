"use client";

import { openAddUnitDetails } from "./AddUnitDetails";

/**
 * The two "+ Add a unit" doors (the page header, the empty state) into the
 * collapsed form at the bottom of the page. Not a `<a href="#add-unit">`
 * (`lint/a11y/useValidAnchor` refuses an anchor whose href is only a click
 * handler in disguise, and it would be exactly that here): opening it is
 * `AddUnitDetails`'s own React state, asked for via `openAddUnitDetails()`
 * rather than reached into as a DOM node — a `details.open = true` mutation
 * from outside React is exactly the kind of change an unrelated re-render
 * elsewhere on the page can silently undo.
 */
export function AddUnitLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        openAddUnitDetails();
        document.getElementById("add-unit")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }}
    >
      {children}
    </button>
  );
}
