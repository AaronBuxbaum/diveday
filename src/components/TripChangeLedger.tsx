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
): string[] {
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
    return [
      meetingPointChanged ? meetingPoint : null,
      guidanceChanged ? t("trip.changeArrivalGuidance") : null,
      photoChanged ? t("trip.changeArrivalPhoto") : null,
    ].filter((part): part is string => part !== null);
  }
  const summary = valueText(event.afterValue.conditionsSummary);
  if (!summary || summary === valueText(before.conditionsSummary)) return [];
  return [t("trip.changeConditionsWithSummary", { summary })];
}

/**
 * **What changed**: the trip's facts that moved, each once with its newest
 * value, and when (visual review 2026-10-24, B21). One entry per kind of fact,
 * the latest, because a diver needs where the boat leaves from now, not each
 * step it took to get there. No self-description and no source chip; when
 * nothing changed, nothing renders. No private actor data is shown.
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
  const latest = new Map<TripChangeEvent["kind"], TripChangeEvent>();
  for (const event of events) {
    const held = latest.get(event.kind);
    if (!held || event.occurredAt >= held.occurredAt) latest.set(event.kind, event);
  }
  const entries = [...latest.values()]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((event) => ({ event, facts: changedFacts(event, t, revealArrivalDetails) }))
    .filter((entry) => entry.facts.length > 0);
  if (entries.length === 0) return null;
  return (
    <SectionCard title={t("trip.changeLedgerHeading")} className={className}>
      <ol className="flex flex-col gap-4">
        {entries.map(({ event, facts }) => (
          <li key={event.id}>
            {facts.map((fact) => (
              <p key={fact} className="text-sm font-medium">
                {fact}
              </p>
            ))}
            {/* In the shop's own zone, named (`formatDateTimeTz`), never a
                bare `toLocaleString` with its seconds (issue #799). */}
            <p className="mt-1 text-sm text-muted">
              {t("trip.changedAt", { when: formatDateTimeTz(event.occurredAt, locale, timeZone) })}
            </p>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
