import type { ReadyPageData } from "@/db/ready";
import type { latestTripStage } from "@/db/trip-stages";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS, DIVER_DIVE_RECENCY_KEYS } from "@/i18n/readiness-labels";
import { checklistDetailText } from "@/i18n/readiness-summary-labels";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatTime } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { combineCertRequirements } from "@/lib/readiness";
import { buildDiverChecklist } from "@/lib/readiness-summary";
import { nitroxCardWanted } from "@/lib/rentals";
import type { ThreadStep } from "@/lib/thread-steps";
import { liveStageOf, STAGE_SENTENCE_KEYS } from "@/lib/trip-stages";

/**
 * The boat's own line over the readiness thread, or null when no stage speaks.
 *
 * Composed here: word order and where the site sits in
 * the sentence are the locale's choice, and `liveStageOf` is what stops a
 * stage nobody cleared speaking for a departure that ended yesterday.
 */
export function boatStageLine(
  boatStage: Awaited<ReturnType<typeof latestTripStage>>,
  trip: { title: string; endsAt: Date | null },
  timeZone: string,
  locale: DiverLocale,
  t: DiverTranslator,
): { sentence: string; said: string } | null {
  const liveStage = liveStageOf(boatStage, trip.endsAt ?? null, nowDate());
  return liveStage
    ? {
        sentence:
          liveStage.stage === "underway" && !liveStage.siteName
            ? t("tripStage.underwayNoSite", { boat: trip.title })
            : t(STAGE_SENTENCE_KEYS[liveStage.stage], {
                boat: trip.title,
                site: liveStage.siteName ?? "",
              }),
        said: t("tripStage.said", {
          time: formatTime(liveStage.recordedAt, locale, timeZone),
        }),
      }
    : null;
}

/**
 * What the readiness thread knows about this booking before it lays out the
 * spine: the checklist, the fare and the balance it quotes, the rung the
 * departure demands, which questions the diver has answered, and whether the
 * nitrox card can be offered. Pure: every input was read by the page.
 *
 * `tripOnRecord` is whether the trip page's own read found the departure;
 * without it the thread quotes no fare.
 */
export function readyThreadFacts(data: ReadyPageData, tripOnRecord: boolean, locale: DiverLocale) {
  const { detail, shop } = data;
  // What one seat on this departure costs. Null on an unpriced trip, which
  // then quotes nothing rather than guessing — see `resolvePaymentReceipt`,
  // which takes the same figure to work out a balance after a deposit.
  // This seat's price: a snorkeler pays the snorkeler fare (ADR
  // 20261007-participant-types), as `getReadyPageData` read it.
  const fullPriceCents = tripOnRecord ? data.trip.seatPriceCents : null;

  const items = buildDiverChecklist(detail.requirement, detail.readiness);
  /**
   * **A balance nobody named.** "There's a balance to settle" is the one step
   * on this spine whose whole subject is a number, and it carried none — the
   * amount lived on a receipt panel that exists only once something has
   * *already* settled, so the diver being asked to pay was the one reader who
   * could not see the figure.
   *
   * The trip's own list price, in the shop's currency. This is raised only on
   * an unpaid or refunded booking — `PAYMENT_CLEARED` clears a part-paid
   * deposit, so a fare is either owed whole or not owed here at all — and an
   * unpriced departure quotes nothing rather than a guess. A *settled* payment
   * quotes the receipt instead: what was actually charged is evidence, and it
   * outranks a list price that may have moved since (ADR
   * 20260731-shop-currency reasons the same way about currency).
   */
  const amountDueText =
    fullPriceCents !== null && fullPriceCents > 0
      ? formatMoneyCents(fullPriceCents, toShopCurrency(shop.currency), locale)
      : null;
  /**
   * The rung this departure actually demands — the stricter of what the shop
   * set on the trip and what the sites it visits impose
   * (`combineCertRequirements`, the same fold the readiness engine gates on).
   *
   * Named on the certification step (issue 627) because "we still need your
   * certification card" never said *which* card, and a diver holding Open Water
   * had no way to tell from this page whether the Advanced they don't have was
   * the thing standing between them and the boat. Null when the departure gates
   * on specialties or nitrox but no level, which is a real shape.
   */
  const requiredLevel = detail.requirement
    ? combineCertRequirements(detail.requirement, detail.siteRequirement).minimumCertificationLevel
    : null;
  // A rental fit is on file — the diver has answered the gear question at least
  // once, whatever they answered. "Bringing my own" is a complete answer, so
  // this asks whether the question was answered, never whether anything was
  // rented. `fitStatedAt`, not the row's existence: the note below writes the
  // same `rental_fit_profiles` row without stating a fit (schema.ts).
  const hasRentalFit = data.rentalFit?.fitStatedAt != null;
  // The diver has answered the currency question at least once. Every band is
  // a complete answer, "I haven't dived yet" included.
  const hasLastDived = data.lastDivedBand != null;
  // Whether to ask for a nitrox card nothing has asked for yet — the rule
  // itself lives in `src/lib/rentals.ts` beside `nitroxAvailableOn`, because
  // the card disclosure and the rental form's request lock are two surfaces
  // that must answer it identically.
  const offerNitroxCard = nitroxCardWanted(shop.rentalItems, data.trip.course, {
    verified: data.nitroxCardVerified,
    onFile: data.nitroxCardOnFile,
  });
  /**
   * ...and whether this page can actually make that offer. The disclosure
   * lives inside the certification step, so it can only be rendered on a
   * booking that has one. `RentalFitForm` locks on this single boolean rather
   * than on a second copy of the rule, so the lock and the offer cannot
   * disagree.
   */
  const nitroxCardEntryOffered =
    offerNitroxCard && items.some((item) => item.category === "certification");

  /**
   * **The shop was already holding this diver's sizes before they booked this
   * seat** — which is what makes "Anything changed?" a question about last
   * time (ADR 20260904-reef-all-the-way-down, D15).
   *
   * The comparison is against `bookings.created_at` rather than against "does a
   * fit exist": a wider test would turn true the instant a first-timer saved
   * their sizes, and the step would appear mid-thread asking whether the thing
   * they had just typed had changed. A staff edit made after the booking leaves
   * the ordinary gear row instead — rarer than the naive test, and never wrong.
   *
   * **Both sides must come from the same clock, and that is not free.**
   * `fit_stated_at` is written through `nowDate()`; `bookings.created_at` was
   * a `defaultNow()` column, which Postgres stamps and `DIVEDAY_CLOCK` cannot
   * reach. Straddling the two made this "compare a frozen instant against a
   * live one" (`dbNow`'s docblock in `src/test/db.ts`), and since the frozen
   * instant sits weeks behind the wall clock under the e2e harness, every fit
   * read as last season's and every diver as a returning one — the gear step
   * vanished fleet-wide. `createBooking` now stamps `created_at` from the
   * application clock for that reason; do not put a `defaultNow()` column on
   * either side of this again.
   */
  const carriedFacts =
    data.rentalFit?.fitStatedAt != null && data.rentalFit.fitStatedAt < data.bookingCreatedAt;

  return {
    items,
    fullPriceCents,
    amountDueText,
    requiredLevel,
    hasRentalFit,
    hasLastDived,
    nitroxCardEntryOffered,
    carriedFacts,
  };
}

export type ReadyThreadFacts = ReturnType<typeof readyThreadFacts>;

/** One step's fact: the line under its title. The other thing the spine cannot derive is its form. */
export function readyStepLine(
  step: ThreadStep,
  {
    t,
    facts,
    lastDivedBand,
    paidLine,
  }: {
    t: DiverTranslator;
    facts: ReadyThreadFacts;
    lastDivedBand: ReadyPageData["lastDivedBand"];
    /** The Pay step's settled line (`payStepLines`). */
    paidLine: string;
  },
): string | null {
  const { hasRentalFit, hasLastDived, requiredLevel, amountDueText } = facts;
  if (step.id === "gear") return hasRentalFit ? t("ready.gearOnFile") : null;
  // A settled "Anything changed?" states the same fact the gear step would
  // have: the crew has their sizes. No second sentence for one fact, and
  // nothing that says "you confirmed" — the diver knows what they tapped.
  if (step.id === "changes") {
    return step.state === "done" ? t("ready.gearOnFile") : null;
  }
  if (step.id === "dayof") {
    return hasLastDived && lastDivedBand ? t(DIVER_DIVE_RECENCY_KEYS[lastDivedBand]) : null;
  }
  if (step.id === "pay" && step.state === "done") return paidLine;
  if (!step.item) return null;
  // The certification step names which rung, on every state including
  // "done" — a diver reading a settled step still wants to know what it
  // settled against (issue 627).
  if (step.item.category === "certification" && requiredLevel) {
    return `${checklistDetailText(t, step.item)} ${t("ready.certMinimumLevel", {
      level: t(DIVER_CERTIFICATION_LEVEL_KEYS[requiredLevel]),
    })}`;
  }
  if (step.id === "pay" && step.state === "your_turn" && amountDueText) {
    return t("ready.checklistDetail.paymentDueAmount", { amount: amountDueText });
  }
  return checklistDetailText(t, step.item);
}
