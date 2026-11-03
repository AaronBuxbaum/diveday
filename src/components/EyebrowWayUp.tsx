"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EYEBROW_CLASS, EyebrowBackLink } from "@/components/ShopPageHeader";
import { wayUpHref } from "@/lib/staff-routes";

/**
 * **The eyebrow, linked to the page above this one, read off the URL**
 * (issue #2748, principle 10).
 *
 * The href comes from the route tree (`src/lib/staff-routes.ts`) and the
 * current pathname, never from the page: a page has one way up and the URL
 * already says what it is. Where the tree gives no parent (depth 1, a
 * section's own home) the words stand as a plain eyebrow.
 *
 * `returnTo` is for the few pages opened *from* somewhere that is not their
 * parent, which only a query can say: a new diver added from a departure goes
 * back to that departure, the board's add form goes back to the week it was
 * opened on. Never a second spelling of the parent's href. `null` is an
 * embedded page: the frame on a shop's own site has no parent to go to.
 */
export function EyebrowWayUp({
  children,
  className = "",
  returnTo,
}: {
  children: ReactNode;
  className?: string;
  returnTo?: string | null;
}) {
  const pathname = usePathname();
  const href = returnTo === undefined ? wayUpHref(pathname ?? "") : returnTo;
  if (href === null) {
    return <p className={`${EYEBROW_CLASS} ${className}`.trim()}>{children}</p>;
  }
  return (
    <EyebrowBackLink href={href} className={className}>
      {children}
    </EyebrowBackLink>
  );
}
