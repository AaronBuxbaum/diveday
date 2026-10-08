import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";

/**
 * **The month rail** above the public schedule: the month being read, and an
 * arrow to step a month either way.
 *
 * A labeled region rather than a `<nav>` landmark, matching the month grid it
 * replaced: the embed widget promises "no page chrome" as literally zero
 * navigation landmarks inside the iframe (e2e/schedule-embed.spec.ts), and two
 * month arrows don't merit one.
 *
 * The arrows sit beside the label they page, not floated to the far edge of the
 * viewport — a control detached from its object is a control the reader has to
 * go looking for (principle 10; the lone `›` at the right margin read as a
 * stray glyph on a phone).
 */
export function MonthRail({
  "aria-label": label,
  month,
  previous,
  next,
}: {
  "aria-label": string;
  /** The month being read, already in the diver's words. */
  month: string;
  previous: { href: string; label: string } | null;
  next: { href: string; label: string } | null;
}) {
  return (
    <section aria-label={label} className="mb-4 flex flex-wrap items-center gap-2">
      <p className="text-base font-semibold">{month}</p>
      {previous ? (
        <Link
          href={previous.href}
          aria-label={previous.label}
          scroll={false}
          className={buttonClass({ variant: "ghost", size: "icon-sm" })}
        >
          <DiveDayIcon name="chevron-left" className="size-4" />
        </Link>
      ) : null}
      {next ? (
        <Link
          href={next.href}
          aria-label={next.label}
          scroll={false}
          className={buttonClass({ variant: "ghost", size: "icon-sm" })}
        >
          <DiveDayIcon name="chevron-right" className="size-4" />
        </Link>
      ) : null}
    </section>
  );
}
