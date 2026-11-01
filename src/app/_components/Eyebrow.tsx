import type { ReactNode } from "react";
import { MARKETING_EYEBROW_CLASS } from "@/components/ui/typography";

/**
 * **The one eyebrow on DiveDay's own pages** (visual review 2026-10-24, B13):
 * uppercase, tracked, in the primary ink. Every marketing section that names
 * itself above its heading uses this, on `/`, `/product`, `/pricing`,
 * `/about`, `/status` and `/switching/*`. The page had grown four treatments
 * (this one, a sentence-case teal marker, an uppercase gray and a plain gray),
 * and a reader cannot tell which difference means something.
 *
 * `as="h1"` is `/about`'s hero, where the eyebrow is the page's heading (H-20261006-about-say-whose-voice);
 * `as="h2"`/`"h3"` where the eyebrow is the only name a block has.
 */
export function Eyebrow({
  as: Tag = "p",
  className,
  children,
}: {
  as?: "p" | "h1" | "h2" | "h3" | "dt" | "span";
  /** Placement only: margins. Never colour, case or weight. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={className ? `${MARKETING_EYEBROW_CLASS} ${className}` : MARKETING_EYEBROW_CLASS}
    >
      {children}
    </Tag>
  );
}
