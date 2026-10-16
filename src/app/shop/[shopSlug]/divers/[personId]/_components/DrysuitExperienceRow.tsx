import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { DRYSUIT_EXPERIENCE_NOTE_MAX, drysuitExperienceRecordable } from "@/lib/drysuit-card";
import { formatShortDate } from "@/lib/format";
import { clearDrysuitExperienceAction, recordDrysuitExperienceAction } from "../card-actions";
import type { DiverProfile, Shop } from "./shared";

/**
 * **A staffer's "seen diving dry"** (issue #2136), as one list item in the
 * certifications group. Deliberately not a `CardRow`: it is staff-observed, not
 * a card, and must never read as one. It quiets the roster's drysuit-card
 * advisory and nothing else.
 *
 * Recorded, it names who, when and what they saw, with a Clear control.
 * Unrecorded, it offers the control only where the writer would accept it
 * (`drysuitExperienceRecordable`: dives dry, no drysuit card on file), and
 * asks what was seen; every other diver's record carries nothing new.
 */
export function DrysuitExperienceRow({
  diver,
  shop,
  shopSlug,
  personId,
  locale,
  t,
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
}) {
  const seenAt = diver.person.drysuitExperienceSeenAt;
  if (seenAt) {
    return (
      <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <p className="font-medium">{t("divers.certifications.drysuitSeenTitle")}</p>
          <p className="mt-1 text-sm text-muted">
            {t("divers.certifications.drysuitSeenNote", {
              date: formatShortDate(seenAt, locale, shop.timezone),
              name:
                diver.drysuitExperienceSeenByName ??
                t("divers.certifications.drysuitSeenByUnknown"),
            })}
          </p>
          {diver.person.drysuitExperienceSeenNote ? (
            <p className="mt-1 text-sm">{diver.person.drysuitExperienceSeenNote}</p>
          ) : null}
        </div>
        <form action={clearDrysuitExperienceAction.bind(null, shopSlug, personId)}>
          <SubmitButton
            pendingLabel={t("divers.certifications.clearingDrysuitSeen")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("divers.certifications.clearDrysuitSeen")}
          </SubmitButton>
        </form>
      </li>
    );
  }
  if (
    !drysuitExperienceRecordable(diver.rentalFit?.divesDry === true, diver.specialtyCertifications)
  ) {
    return null;
  }
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:px-6">
      <p className="min-w-0 text-sm text-muted">{t("divers.certifications.drysuitSeenHint")}</p>
      <form
        action={recordDrysuitExperienceAction.bind(null, shopSlug, personId)}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">{t("divers.certifications.drysuitSeenNoteLabel")}</span>
          <input
            name="note"
            required
            maxLength={DRYSUIT_EXPERIENCE_NOTE_MAX}
            placeholder={t("divers.certifications.drysuitSeenNotePlaceholder")}
            className={controlClass}
          />
        </label>
        <SubmitButton
          pendingLabel={t("divers.certifications.recordingDrysuitSeen")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("divers.certifications.recordDrysuitSeen")}
        </SubmitButton>
      </form>
    </li>
  );
}
