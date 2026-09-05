import Link from "next/link";
import { SectionCard } from "@/components/ui/card";
import type { DiverTranslator } from "@/i18n/messages";
import type { NextDivePick } from "@/lib/next-dive";
import { publicTripPath } from "@/lib/public-routes";

/**
 * **One next dive, and one reason it is that one** — delight report D35 (issue
 * #1195), slice 16i of ADR 20260904-reef-all-the-way-down.
 *
 * The rules live in `src/lib/next-dive.ts` and the reason arrives here already
 * worded (`buildAfterStateProps`), so this file decides nothing about *which*
 * departure it is showing. What it decides is that the card says **one**
 * reason, in a sentence a reader can check against their own memory of the day,
 * and that it says nothing at all when there is no pick.
 *
 * **No score, no strength, no "recommended for you".** The card is either
 * telling the diver a fact about this departure or it has no business being on
 * a keepsake, and the props it takes carry nothing that could grow into a
 * ranking a reader has to take on trust.
 *
 * `print:hidden` like everything else outside the record.
 */
export function NextDiveCard({
  t,
  shopSlug,
  pick,
  when,
  reason,
  levelCovers,
}: {
  t: DiverTranslator;
  shopSlug: string;
  /** Null renders nothing — an empty board is not a heading over an absence. */
  pick: NextDivePick | null;
  /** The departure's day, already worded in the shop's zone. */
  when: string;
  /** The one reason sentence, already resolved from the pick's code. */
  reason: string;
  /** "Your Advanced card covers it", or null when the trip demands no level. */
  levelCovers: string | null;
}) {
  if (!pick) return null;

  return (
    <SectionCard padding="lg" className="mt-10 print:hidden" title={t("recap.nextDiveHeading")}>
      {/* The departure's own name, not a heading: `SectionCard` already owns the
          only heading on this card, and a second one would give a keepsake two
          titles a screen reader reads in a row. Weighted rather than ramped for
          the same reason (`pnpm check:type-ramp`). */}
      <p className="mt-1 text-lg font-medium">
        <Link href={publicTripPath(shopSlug, pick.tripId)} className="text-primary hover:underline">
          {pick.title}
        </Link>
      </p>
      <p className="mt-1 text-base text-muted">{when}</p>
      <p className="mt-3 text-base">{reason}</p>
      {/* Only when the departure demands a level. On one that asks nothing of
          anybody, saying so is the absence of a rule dressed up as a rule. */}
      {levelCovers ? <p className="mt-1 text-sm text-muted">{levelCovers}</p> : null}
      <p className="mt-3 text-sm text-muted tabular-nums">
        {t("recap.nextDiveSeats", { count: pick.seatsLeft })}
      </p>
    </SectionCard>
  );
}
