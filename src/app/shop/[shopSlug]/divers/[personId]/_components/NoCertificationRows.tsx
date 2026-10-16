import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { clearNoCertificationAction } from "../card-actions";
import type { DiverProfile, Shop } from "./shared";

/**
 * The list items about a diver's "I hold no card": the standing statement with
 * its correction, the empty state when nothing else is on file, and the note a
 * correction leaves behind. Rendered inside the certifications group's `<ul>`.
 */
export function NoCertificationRows({
  diver,
  shop,
  shopSlug,
  personId,
  locale,
  t,
  declared: noCertificationDeclared,
  empty,
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
  /** The diver's own "I hold no card" still stands (set, uncleared, not refuted by a card). */
  declared: boolean;
  /** The group has no card rows. */
  empty: boolean;
}) {
  return (
    <>
      {noCertificationDeclared ? (
        /* **The one statement on this record a staffer could not correct.**
             `people.no_certification_declared_at` is written by two
             unauthenticated forms that resolve a person by shop + email, so for
             a diver the shop holds no card for, anybody with a name and an
             email address off a manifest can leave it here.

             Warning ink and worded as the diver's own word, the same way a
             self-declared card is, because it is exactly as weak. Clearing it
             takes the record to *silence*, never to "certified". The phrase
             comes from `shared.certificationSummary.notCertified` and is never
             respelled here. */
        <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="font-medium text-warning-strong">
              {t("shared.certificationSummary.notCertified")}
            </p>
            <p className="mt-1 text-sm text-muted">
              {t("divers.certifications.clearNoCertificationHint")}
            </p>
            {/* **This came back after somebody already corrected it.** A set
                  `clearedByPersonId` beside a null `clearedAt` is the one state
                  the plain panel would render identically to a first-time
                  answer — and the difference is the signal: it separates
                  "somebody is looping this through the public form" from "the
                  diver really did answer that". */}
            {diver.person.noCertificationClearedByPersonId ? (
              <p className="mt-1 text-sm text-muted">
                {t("divers.certifications.noCertificationRestated")}
              </p>
            ) : null}
          </div>
          <form action={clearNoCertificationAction.bind(null, shopSlug, personId)}>
            <SubmitButton
              pendingLabel={t("divers.certifications.clearingNoCertification")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("divers.certifications.clearNoCertification")}
            </SubmitButton>
          </form>
        </li>
      ) : null}
      {empty && !noCertificationDeclared ? (
        <li className="px-5 py-4 text-sm text-muted sm:px-6">{t("divers.certifications.empty")}</li>
      ) : null}
      {/* **A correction that leaves no mark is not a correction.** The panel
            above unmounts the moment it succeeds, so without this line the next
            staffer cannot see that this diver ever gave that answer, or that a
            colleague overrode it. */}
      {!noCertificationDeclared && diver.person.noCertificationClearedAt ? (
        <li className="px-5 py-4 text-sm text-muted sm:px-6">
          {t("divers.certifications.noCertificationClearedNote", {
            date: formatShortDate(diver.person.noCertificationClearedAt, locale, shop.timezone),
            name:
              diver.noCertificationClearedByName ??
              t("divers.certifications.noCertificationClearedByUnknown"),
          })}
        </li>
      ) : null}
    </>
  );
}
