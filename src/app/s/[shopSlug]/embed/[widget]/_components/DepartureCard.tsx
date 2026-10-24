import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * One departure as a card. A full boat has no Book button (visual review
 * 2026-10-24, B32): the muted "Full" says so, and when the shop keeps a wait
 * list one link goes to it on the trip page, whose wait-list form carries the
 * same `#book` anchor.
 */
export function DepartureCard({
  title,
  when,
  site,
  price,
  seats,
  href,
  waitlist,
  t,
}: {
  title: string;
  when: string;
  site: string | null;
  price: string | null;
  seats: { text: string; full: boolean };
  href: string;
  /** The shop keeps a wait list, so a full boat offers to tell the diver. */
  waitlist: boolean;
  t: DiverTranslator;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4 shadow-bed">
      <h2 className="font-brand-display text-base font-semibold">{title}</h2>
      <p className="text-sm tabular-nums">{when}</p>
      {site ? <p className="text-sm text-muted">{site}</p> : null}
      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        {/* The price at the footer's own size, as a course card's price in
            the same slot of the same grid; only the seats step down. Both
            were `text-sm`, so "$95" stood 2px shorter than "$175" (K-377). */}
        <span>
          {price ? <span className="font-semibold tabular-nums">{price}</span> : null}
          <span className="text-sm">
            {price ? " · " : ""}
            <span className="text-muted">{seats.text}</span>
          </span>
        </span>
        {!seats.full ? (
          <Link href={href} target="_top" className={buttonClass({ size: "sm" })}>
            {t("embed.book")}
          </Link>
        ) : waitlist ? (
          <Link
            href={href}
            target="_top"
            className="text-sm font-medium text-primary hover:underline focus-visible:focus-ring"
          >
            {t("embed.askToBeTold")}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
