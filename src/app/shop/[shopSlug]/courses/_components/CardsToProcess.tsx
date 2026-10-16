import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { type CardToProcess, type CardWhat, cardIsLate } from "@/db/agency-processing";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";

function cardName(what: CardWhat, t: StaffTranslator): string {
  if (what.kind === "level") return t(CERTIFICATION_LEVEL_KEYS[what.level]);
  if (what.kind === "specialty") return t(SPECIALTY_KEYS[what.specialty]);
  return t("shared.certificationSummary.nitrox");
}

/**
 * **Cards still to process with the agency** (fifth-loop ideas, item 46):
 * every card this shop issued (level, Enriched Air or specialty) that nobody
 * has marked sent to the agency, grouped by agency, oldest first. Nothing
 * ages off the list; a card waiting more than 30 days says so. "Mark sent" on
 * a row takes it off; the session roster's tick is the same stamp, and takes
 * it back.
 */
export function CardsToProcess({
  cards,
  markProcessed,
  now,
  locale,
  timeZone,
  t,
}: {
  cards: CardToProcess[];
  markProcessed: (formData: FormData) => void;
  now: Date;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  if (cards.length === 0) return null;
  const byAgency = new Map<CardToProcess["agency"], CardToProcess[]>();
  for (const card of cards) byAgency.set(card.agency, [...(byAgency.get(card.agency) ?? []), card]);
  const agencyName = (agency: CardToProcess["agency"]) =>
    agency === "other" ? t("trips.roster.processedAgencyUnnamed") : t(AGENCY_KEYS[agency]);
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
              agency: agencyName(agency),
            })}
          </p>
          <ul className="divide-y divide-border rounded-panel border border-border">
            {group.map((card) => {
              const late = cardIsLate(card.issuedAt, now);
              return (
                <li
                  key={`${card.kind}:${card.certificationId}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm"
                  data-late={late || undefined}
                >
                  <span>
                    <span className="font-medium">{card.fullName}</span>{" "}
                    <span className="text-muted">
                      {t("courses.processing.cardLine", {
                        card: cardName(card.what, t),
                        date: formatShortDate(card.issuedAt, locale, timeZone),
                      })}
                    </span>
                    {late ? (
                      <span className="ms-2 font-medium text-warning-strong">
                        {t("courses.processing.late")}
                      </span>
                    ) : null}
                  </span>
                  <form action={markProcessed}>
                    <input type="hidden" name="cardKind" value={card.kind} />
                    <input type="hidden" name="certificationId" value={card.certificationId} />
                    <SubmitButton
                      pendingLabel={t("trips.roster.processedSaving")}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("courses.processing.mark", { agency: agencyName(card.agency) })}
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
