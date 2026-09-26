import { GroupLabel, LedgerRow } from "@/components/ui/ledger";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import type { PartOfDay, WorthALookReason } from "@/lib/worth-a-look";

/**
 * The reason a departure is offered, as a sentence in the reader's own
 * language. `src/lib/worth-a-look.ts` returns codes; this is where they become
 * words.
 *
 * Every key is spelled out rather than built with a template literal, so the
 * message-key type checking stays static.
 *
 * `same_time_of_day` is the one reason with three spellings, because the fact
 * it states is which part of the day — "also a morning boat" and "also an
 * afternoon boat" are different sentences, and one of them is always wrong.
 */
const REASON_KEY: Record<Exclude<WorthALookReason, "same_time_of_day">, DiverMessageKey> = {
  same_course: "booking.worthALook.sameCourse",
  same_site: "booking.worthALook.sameSite",
  gentler: "booking.worthALook.gentler",
  more_room: "booking.worthALook.moreRoom",
};

const PART_OF_DAY_KEY: Record<PartOfDay, DiverMessageKey> = {
  morning: "booking.worthALook.alsoMorning",
  afternoon: "booking.worthALook.alsoAfternoon",
  evening: "booking.worthALook.alsoEvening",
};

export type TripAlternative = {
  tripId: string;
  title: string;
  href: string;
  /** Already formatted in the shop's own zone by the page, like every other date it hands down. */
  when: string;
  seatsOpen: number;
  reason: WorthALookReason;
  /** Which part of the shop's day this departure leaves in — only read for `same_time_of_day`. */
  partOfDay: PartOfDay;
};

/**
 * **The right departure, not just the next open seat** (ADR
 * 20260904-reef-all-the-way-down; issue #1161, delight report D01).
 *
 * At most two other departures a diver reading this one might prefer, each
 * printing the visible fact that put it here. Guidance and never a gate: every
 * reason `worthALook` can return points at a boat that asks *less* than this
 * one, or at the same thing on another day, and this page's own form is
 * untouched — the diver can ignore every word of this and book the boat they
 * came for.
 *
 * Renders nothing for an empty list, which is most departures. It also never
 * renders on a **full** departure: `TripFullSection` stands there with D06's
 * own list, and two lists of other boats on one page is exactly the accretion
 * this slice exists to bound.
 */
export function TripAlternatives({
  alternatives,
  locale,
}: {
  alternatives: readonly TripAlternative[];
  locale: string;
}) {
  if (alternatives.length === 0) return null;
  const t = diverTranslator(locale);
  return (
    <section className="mt-8">
      <GroupLabel as="h2">{t("booking.alsoOnTheSchedule")}</GroupLabel>
      <ul className="mt-2">
        {alternatives.map((alternative) => (
          <LedgerRow
            key={alternative.tripId}
            href={alternative.href}
            linkLabel={alternative.title}
            kind={{ word: alternative.when, tone: "neutral" }}
            stacked
            trailing={
              <span className="text-sm text-muted tabular-nums">
                {t("fallback.spotsLeft", { count: alternative.seatsOpen })}
              </span>
            }
          >
            <span className="block text-sm font-medium">{alternative.title}</span>
            {/* The reason, printed. An unexplained list of other boats is the
                schedule page with extra steps, and #1161's boundary is that a
                suggestion shows the visible facts behind it. */}
            <span className="block text-sm text-muted">
              {t(
                alternative.reason === "same_time_of_day"
                  ? PART_OF_DAY_KEY[alternative.partOfDay]
                  : REASON_KEY[alternative.reason],
              )}
            </span>
          </LedgerRow>
        ))}
      </ul>
    </section>
  );
}
