import Link from "next/link";
import type { ReactNode } from "react";
import { tapTargetLinkClass } from "@/components/ui/button";

/**
 * **"Powered by DiveDay" at the foot of a frame** — under the storefront's
 * `?embed=1` board and under each of the three catalogue widgets
 * (`/s/[shopSlug]/embed/[widget]`), wherever the loader has not drawn the
 * crawlable credit on the host page instead.
 *
 * **A 44px target on a 16px line** (pixel-craft class 7, K-217 and K-220).
 * Both frames drew it by hand as a `text-xs` link in a `<p>`: a 115.7×15 box,
 * the one thing in either frame a thumb could miss. The link now carries
 * `tapTargetLinkClass`'s 44px floor and the line stays the `text-xs` line's
 * 16px, the box centred on it, so the words sit where they sat and the
 * frame's content is laid out as it was.
 *
 * **The room the box and its ring reach into is the credit's own.** The box
 * reaches 14px past each side of the line and the focus ring 5px past the
 * box. Above, `mt-4` holds the box clear of whatever the frame shows last.
 * Below, the frame's own padding (12px in the widgets, 16px under the board)
 * and `mb-2` hold the ring: the frame is sized to its document, and a ring
 * that ran past the document's end would be cut off by the host's iframe.
 */
export function EmbedCredit({
  href,
  target,
  rel,
  children,
}: {
  href: string;
  /** `_top` to leave the frame for DiveDay's own page, `_blank` for a new tab. */
  target?: "_top" | "_blank";
  rel?: string;
  /** The words, from the caller's bundle (`schedule.poweredByDiveDay`). */
  children: ReactNode;
}) {
  return (
    <p className="mt-4 mb-2 flex h-4 items-center justify-center text-xs text-muted">
      <Link
        href={href}
        target={target}
        rel={rel}
        className={`${tapTargetLinkClass} hover:underline`}
      >
        {children}
      </Link>
    </p>
  );
}
