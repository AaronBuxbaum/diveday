"use client";

import { useEffect, useState } from "react";

/**
 * **Says when React owns a page's body**, not just its header. A staff page's
 * header hydrates first, and the body's effects (`ScrollToHash`, `FlashParams`)
 * run later; the e2e fixture waits on this mark before it clicks
 * (`settleStaffHydration`). Render it last in the body, outside any
 * `<Suspense>`, so its effect runs in the same commit as the body's.
 *
 * Drawn one pixel wide (`sr-only`), not `hidden`: a route Next keeps behind a
 * hidden `<Activity>` (a prefetched or earlier page) runs no effects, so the
 * fixture asks only for the mark it can see, the page on screen.
 */
export function PageBodyHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <span
      aria-hidden
      className="sr-only"
      data-page-body=""
      data-hydrated={hydrated ? "true" : undefined}
    />
  );
}
