import { SectionCard } from "@/components/ui/card";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { diverTranslator } from "@/i18n/messages";
import { formatDateTimeTz } from "@/lib/format";
import { tripChangeEntries } from "@/lib/trip-change-entries";

/**
 * **What changed**: the trip's facts that moved, each once with its newest
 * value and when. One entry per fact, at its newest change across every event,
 * because a diver needs where the boat leaves from now, not each step it took
 * to get there. There is no source chip, but the muted line keeps the broad
 * source word, shop or crew (ADR 20260904-reef-all-the-way-down, Budget rule 5;
 * glossary "Change ledger"). An office edit must never read as the crew's word
 * from the dock. When nothing changed, nothing renders. No private actor data
 * is shown.
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
  const entries = tripChangeEntries(events, locale, revealArrivalDetails);
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
