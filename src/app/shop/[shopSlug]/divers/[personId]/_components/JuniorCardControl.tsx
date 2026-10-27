import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { recordJuniorStatusAction } from "../card-actions";

export function JuniorCardStatus({
  card,
  t,
}: {
  card: { status: "pending" | "verified"; juniorStatus: "junior" | "full" | null };
  t: StaffTranslator;
}) {
  if (card.status !== "verified") return null;
  const status = card.juniorStatus;
  return (
    <span className="block">
      {t(
        status === "junior"
          ? "divers.certifications.juniorCardJunior"
          : status === "full"
            ? "divers.certifications.juniorCardFull"
            : "divers.certifications.juniorCardUnknown",
      )}
    </span>
  );
}

/** A staff sighting, attached to the card it describes; the empty choice is never evidence. */
export function JuniorCardControl({
  card,
  shopSlug,
  personId,
  locale,
  timezone,
  t,
}: {
  card: {
    id: string;
    juniorStatusVerifiedAt: Date | null;
    juniorStatusVerifiedByName: string | null;
  };
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  return (
    <details>
      <summary>{t("divers.certifications.juniorCardChange")}</summary>
      {card.juniorStatusVerifiedAt ? (
        <p>
          {t("divers.certifications.juniorCardVerifiedBy", {
            name: card.juniorStatusVerifiedByName ?? t("divers.certifications.juniorCardStaff"),
            date: formatShortDate(card.juniorStatusVerifiedAt, locale, timezone),
          })}
        </p>
      ) : null}
      <p className="mt-2">{t("divers.certifications.juniorCardHint")}</p>
      <form
        action={recordJuniorStatusAction.bind(null, shopSlug, personId)}
        className="mt-2 space-y-2"
      >
        <input type="hidden" name="certificationId" value={card.id} />
        <Field label={t("divers.certifications.juniorCardSelect")}>
          <select name="juniorStatus" required defaultValue="" className={controlClass}>
            <option value="" disabled>
              {t("divers.certifications.juniorCardChoose")}
            </option>
            <option value="junior">{t("divers.certifications.juniorCardOptionJunior")}</option>
            <option value="full">{t("divers.certifications.juniorCardOptionFull")}</option>
          </select>
        </Field>
        <SubmitButton
          pendingLabel={t("divers.certifications.juniorCardSaving")}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("divers.certifications.juniorCardSave")}
        </SubmitButton>
      </form>
    </details>
  );
}
