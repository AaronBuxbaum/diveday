"use client";

import { useEffect } from "react";

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
 * Once per mount, and idempotent beyond that: a second call re-sets the same
 * cookie and adds one open, which is what a second visit is.
 */
export function RememberShelf({ remember }: { remember: () => Promise<void> }) {
  useEffect(() => {
    void remember();
  }, [remember]);
  return null;
}
