"use client";

import { useEffect, useState } from "react";
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
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        openAddUnitDetails();
        document.getElementById("add-unit")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }}
      // **This door does nothing until React owns it**, and it is painted
      // before then. The whole of it — this handler, and the `window` listener
      // `AddUnitDetails` registers to hear from it — is client-side, so a click
      // that lands early is swallowed in silence: no error, no open panel,
      // nothing for a person or a test to see except a form that did not
      // appear. That window used to be closed by accident, because `/shop/**`
      // had no static shell and nothing painted until the server had finished;
      // giving the staff surfaces one (issue 1446) is what made it a window at
      // all, and `e2e/gear.spec.ts` found it on a loaded CI shard.
      //
      // The same `data-hydrated` flag the rest of the staff surfaces publish
      // (`CheckInSearch`, `OrdersToolbar`, `CrewSection`, …), and the e2e suite
      // waits on it before clicking. `AddUnitDetails` needs none of its own:
      // no `<Suspense>` sits between the two, so React attaches its listener in
      // the same commit that runs this effect.
      data-hydrated={hydrated ? "true" : undefined}
    >
      {children}
    </button>
  );
}
