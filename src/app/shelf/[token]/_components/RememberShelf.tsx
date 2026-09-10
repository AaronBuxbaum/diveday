"use client";

import { useEffect, useRef } from "react";

/**
 * Renders nothing. On mount it tells the server this phone opened the shelf,
 * which does two things at once: counts the open on the token's own row, and
 * drops the cookie the shop's storefront reads to greet this diver by name.
 *
 * **A client effect rather than the page's render**, for two reasons pointing
 * the same way. A Server Component may not set a cookie at all. And a page that
 * wrote on GET would count a link-preview fetch, a mail scanner and a
 * prefetcher as a diver opening their own file — which is precisely the number
 * the shop's diver record shows, so it has to mean what it says.
 *
 * **Once per mount, held by a ref rather than by the effect's dependency.**
 * The action sets a cookie, and a server action that sets a cookie re-renders
 * the route in its own response; the page then hands this component a freshly
 * bound `remember`, and an effect keyed on that prop fires again. One visit
 * read as two opens on the diver record until the ref held the line.
 */
export function RememberShelf({ remember }: { remember: () => Promise<void> }) {
  const remembered = useRef(false);
  useEffect(() => {
    if (remembered.current) return;
    remembered.current = true;
    void remember();
  }, [remember]);
  return null;
}
