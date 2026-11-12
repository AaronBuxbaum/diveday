import Link from "next/link";
import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { buttonClass } from "@/components/ui/button";
import type { CardToValidate, CardWhat } from "@/features/agency-processing";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

function cardName(what: CardWhat, t: StaffTranslator): string {
  if (what.kind === "level") return t(CERTIFICATION_LEVEL_KEYS[what.level]);
  if (what.kind === "specialty") return t(SPECIALTY_KEYS[what.specialty]);
  return t("shared.certificationSummary.nitrox");
}

/**
 * **Cards to validate**: every card a diver has on file that nobody has
 * checked with its agency yet (still `pending`, so it clears no gate), oldest
 * first. Each row opens the diver's certifications, where the card is looked
 * up and marked verified. Renders nothing when every card on file is checked.
 */
export function CardsToValidate({
  cards,
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  cards: CardToValidate[];
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  if (cards.length === 0) return null;
  return (
    <section
      aria-labelledby="cards-to-validate-heading"
      className="mt-8 space-y-3"
      data-testid="cards-to-validate"
    >
      <h2 id="cards-to-validate-heading" className="font-semibold">
        {t("courses.validate.heading")}
      </h2>
      <p className="text-sm text-muted">{t("courses.validate.count", { count: cards.length })}</p>
      <ul className="divide-y divide-border rounded-panel border border-border">
        {cards.map((card) => (
          <li
            key={`${card.kind}:${card.certificationId}`}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm"
          >
            <span>
              <span className="font-medium">{card.fullName}</span>{" "}
              <span className="text-muted">
                {t("courses.validate.cardLine", {
                  agency:
                    card.agency === "other"
                      ? t("trips.roster.processedAgencyUnnamed")
                      : t(AGENCY_KEYS[card.agency]),
                  card: cardName(card.what, t),
                  number: card.identifier ?? t("courses.validate.noNumber"),
                  date: formatShortDate(card.addedAt, locale, timeZone),
                })}
              </span>
            </span>
            <Link
              href={`${shopPath(shopSlug, "divers", card.personId)}#certifications`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("courses.validate.open")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
