import { SectionCard } from "@/components/ui/card";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { formatDateTimeTz } from "@/lib/format";

function valueText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const ARRIVAL_GUIDANCE_FIELDS = [
  "arrivalLandmark",
  "arrivalParkingNote",
  "arrivalTransitNote",
  "arrivalLookFor",
  "arrivalFirstInteraction",
] as const;

/** The four facts the card can name; each is listed once, at its newest change. */
type FactKey = "meetingPoint" | "arrivalGuidance" | "arrivalPhoto" | "conditions";

/**
 * The facts one event changed, each "{fact}: {new value}", or none. A part
 * whose value did not move is left out rather than restated (visual review
 * 2026-10-24, B21): the card had repeated the meeting point the page already
 * shows above it, unchanged.
 */
function changedFacts(
  event: TripChangeEvent,
  t: DiverTranslator,
  revealArrivalDetails: boolean,
): [FactKey, string][] {
  const before = event.beforeValue ?? {};
  if (event.kind === "meeting_point") {
    const meetingPointChanged =
      before.meetingPointLabel !== event.afterValue.meetingPointLabel ||
      before.meetingPointAddress !== event.afterValue.meetingPointAddress;
    const guidanceChanged = ARRIVAL_GUIDANCE_FIELDS.some(
      (field) => before[field] !== event.afterValue[field],
    );
    const photoChanged = before.arrivalPhotoUrl !== event.afterValue.arrivalPhotoUrl;
    // Public pages keep the event but never the exact place (arrival details
    // are for booked divers), so the fact is named without its value.
    const label = valueText(event.afterValue.meetingPointLabel) ?? t("trip.arrivalShopDefault");
    const address = valueText(event.afterValue.meetingPointAddress);
    const meetingPoint = !revealArrivalDetails
      ? t("trip.changeMeetingPointUpdated")
      : address
        ? t("trip.changeMeetingPointWithAddress", { label, address })
        : t("trip.changeMeetingPoint", { label });
    const facts: [FactKey, string][] = [];
    if (meetingPointChanged) facts.push(["meetingPoint", meetingPoint]);
    if (guidanceChanged) facts.push(["arrivalGuidance", t("trip.changeArrivalGuidance")]);
    if (photoChanged) facts.push(["arrivalPhoto", t("trip.changeArrivalPhoto")]);
    return facts;
  }
  const summary = valueText(event.afterValue.conditionsSummary);
  const was = valueText(before.conditionsSummary);
  if (summary === was) return [];
  // A cleared note is a change too: a diver who read "Strong current" is told
  // it is gone, not left with the old warning (dive-domain review, B21).
  if (!summary) return was ? [["conditions", t("trip.changeConditionsCleared")]] : [];
  return [["conditions", t("trip.changeConditionsWithSummary", { summary })]];
}

/**
 * **What changed**: the trip's facts that moved, each once with its newest
 * value, and when (visual review 2026-10-24, B21). One entry per fact, at its
 * newest change across every event, because a diver needs where the boat
 * leaves from now, not each step it took to get there. No self-description and no source chip,
 * but the muted line keeps the broad source word, shop or crew (ADR 20260904-reef-all-the-way-down,
 * Budget rule 5; glossary "Change ledger"): an office edit must never read as the crew's word from
 * the dock. When nothing changed, nothing renders. No private actor data is shown.
 */
export function TripChangeLedger({
  events,
  locale,
  timeZone,
  revealArrivalDetails = true,
  className = "",
}: {
  events: readonly TripChangeEvent[];
  locale: string;
  timeZone: string;
  /** Public pages keep the event but omit exact arrival values. */
  revealArrivalDetails?: boolean;
  className?: string;
}) {
  const t = diverTranslator(locale);
  // Each fact at its newest change, across every event: a later event that
  // touched only the arrival photo must not hide the earlier move of the
  // meeting point (dive-domain review, B21).
  const newest = new Map<
    FactKey,
    { text: string; occurredAt: Date; source: TripChangeEvent["source"]; id: string }
  >();
  for (const event of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    for (const [key, text] of changedFacts(event, t, revealArrivalDetails)) {
      newest.set(key, {
        text,
        occurredAt: event.occurredAt,
        source: event.source,
        id: `${event.id}:${key}`,
      });
    }
  }
  const entries = [...newest.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  if (entries.length === 0) return null;
  return (
    <SectionCard title={t("trip.changeLedgerHeading")} className={className}>
      <ol className="flex flex-col gap-4">
        {entries.map(({ text, occurredAt, source, id }) => (
          <li key={id}>
            <p className="text-sm font-medium">{text}</p>
            {/* In the shop's own zone, named (`formatDateTimeTz`), never a
                bare `toLocaleString` with its seconds (issue #799). */}
            <p className="mt-1 text-sm text-muted">
              {t(source === "crew" ? "trip.changedByCrew" : "trip.changedByShop", {
                when: formatDateTimeTz(occurredAt, locale, timeZone),
              })}
            </p>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
