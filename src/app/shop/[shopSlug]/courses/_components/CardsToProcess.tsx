import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { CardToProcess } from "@/db/agency-processing";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";

/**
 * **Cards still to process with the agency** (fifth-loop ideas, item 46): the
 * cards this shop issued in the last 90 days that nobody has ticked as sent to
 * the agency, grouped by agency. "Processed" on a row takes it off the list;
 * the session roster's tick is the same stamp, and takes it back.
 */
export function CardsToProcess({
  cards,
  markProcessed,
  locale,
  timeZone,
  t,
}: {
  cards: CardToProcess[];
  markProcessed: (formData: FormData) => void;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  if (cards.length === 0) return null;
  const byAgency = new Map<CardToProcess["agency"], CardToProcess[]>();
  for (const card of cards) byAgency.set(card.agency, [...(byAgency.get(card.agency) ?? []), card]);
  return (
    <section
      aria-labelledby="cards-to-process-heading"
      className="mt-8 space-y-3"
      data-testid="cards-to-process"
    >
      <h2 id="cards-to-process-heading" className="font-semibold">
        {t("courses.processing.heading")}
      </h2>
      {[...byAgency].map(([agency, group]) => (
        <div key={agency} className="space-y-2">
          <p className="text-sm text-muted">
            {t("courses.processing.agencyLine", {
              count: group.length,
              agency:
                agency === "other"
                  ? t("trips.roster.processedAgencyUnnamed")
                  : t(AGENCY_KEYS[agency]),
            })}
          </p>
          <ul className="divide-y divide-border rounded-panel border border-border">
            {group.map((card) => (
              <li
                key={card.certificationId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{card.fullName}</span>{" "}
                  <span className="text-muted">
                    {t("courses.processing.certifiedOn", {
                      date: formatShortDate(card.issuedAt, locale, timeZone),
                    })}
                  </span>
                </span>
                <form action={markProcessed}>
                  <input type="hidden" name="certificationId" value={card.certificationId} />
                  <SubmitButton
                    pendingLabel={t("trips.roster.processedSaving")}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {t("courses.processing.mark")}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
