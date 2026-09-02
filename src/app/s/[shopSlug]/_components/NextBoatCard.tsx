import Link from "next/link";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FIGURE_LARGE_CLASS } from "@/components/ui/typography";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **The next boat, as a bookable object** — ADR
 * 20260827-clearwater-surface-language, decision 8. The storefront's one card
 * and its one primary action; everything else on the page is type, hairlines
 * and space.
 *
 * Two things it must not drift from:
 *
 * - **One primary.** "Book this boat" goes to the trip page's `#book`, and it
 *   is the only primary-variant control the storefront renders. Every week row
 *   beneath it is a link. When there is no bookable boat, the page's one
 *   primary becomes the date-request composer's own submit — never two.
 * - **It is a pin, not a removal.** This departure keeps its row in the week
 *   below. The predecessor (`pinnedNextDeparture`) suppressed itself whenever
 *   the week's first row already had room, on the reasonable ground that a card
 *   restating the row below it is duplication; the recomposition makes the card
 *   the page's *subject* instead, so the answer is to keep the week honest
 *   rather than to withhold the shopfront's lead.
 *
 * On the panel's bed, `rounded-panel` from `SectionCard` — the `rounded-3xl`
 * `border-primary/25 bg-primary/5 shadow-sm` panel this replaces was one of the
 * two one-off radii decision 1 retired.
 */
export function NextBoatCard({
  href,
  when,
  time,
  title,
  description,
  spots,
  price,
  t,
}: {
  /** The trip page's booking anchor. */
  href: string;
  /** "Aug 27", or the relative day word when the boat leaves today or tomorrow. */
  when: string;
  time: string;
  title: string;
  /** The shop's own line about this departure — the one detail line the card keeps. */
  description: string | null;
  /** Already-worded capacity ("5 spots left"); this card only renders for a boat with room. */
  spots: string;
  /** Already-formatted money, or null for a departure with no price set. */
  price: string | null;
  t: DiverTranslator;
}) {
  return (
    <SectionCard
      as="section"
      ariaLabel={t("schedule.nextDeparture.eyebrow")}
      className="flex flex-col gap-4"
    >
      <div className="min-w-0">
        <p className={EYEBROW_CLASS}>{t("schedule.nextDeparture.eyebrow")}</p>
        {/* The departure time is the figure a returning diver came to check,
            with the day reading as its caption (decision 3: numbers that lead
            render as figures). */}
        <p className={`mt-2 ${FIGURE_LARGE_CLASS}`}>
          {time}
          <span className="ms-2 text-lg font-medium text-muted">{when}</span>
        </p>
        <h2 className="mt-1 text-lg font-medium text-pretty">{title}</h2>
        {description ? <p className="mt-2 line-clamp-2 text-sm text-muted">{description}</p> : null}
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums">
          <span className="font-medium">{spots}</span>
          {price ? (
            <span className="text-muted">
              · {price} {t("common.perDiver")}
            </span>
          ) : null}
        </p>
      </div>
      <Link href={href} className={buttonClass({ variant: "primary", className: "w-full" })}>
        {t("schedule.shopfront.bookThisBoat")}
      </Link>
    </SectionCard>
  );
}
