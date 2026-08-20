import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import { addSpecialtyAction, deleteSpecialtyAction, reviewSpecialtyAction } from "../actions";
import { CardSightingForm } from "./CardSightingForm";
import { CardStatusMark } from "./CardStatusMark";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import {
  AGENCY_KEYS,
  type DiverProfile,
  HELD_CARD_STATUS_KEYS,
  heldCardDisplayStatus,
  heldCardStatusTone,
  isImportedCard,
  needsImportConfirm,
  type Shop,
} from "./shared";

export function SpecialtyCards({
  diver,
  shopSlug,
  personId,
  shop,
  locale,
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  shop: Shop;
  locale: string;
  /** This section's own outcome, rendered beside its controls, not page-top. */
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  // A refused card *number* goes on the box it names — see CertificationCards.
  // Here it can only have come from the nitrox sighting form, the one control
  // on this section that asks for a number a staffer reads off a card.
  const numberError = status?.field === "sighted-identifier" ? status.text : undefined;
  // Mark certified and capture success notices belong to the card row, never
  // to this add-specialty form. Render all feedback beside the cards so the
  // disclosure itself never claims an unrelated action succeeded.
  const sectionStatus = !numberError && status?.form === "specialty-cards" ? status : undefined;
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="specialty-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="specialty-heading" className="text-lg font-semibold">
            {t("divers.specialty.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.specialty.description")}</p>
        </div>
        <details className="relative ml-auto shrink-0">
          <summary className={`${buttonClass()} list-none [&::-webkit-details-marker]:hidden`}>
            {t("divers.specialty.addSpecialty")}
          </summary>
          <div className="absolute top-full right-0 z-30 mt-2 max-w-[calc(100vw-2rem)]">
            {/* No `encType`: a function `action` is a server action, not a
                native form post — React builds the `FormData` (files intact)
                and ships it over its own transport, so the browser never reads
                this attribute. Setting it anyway just trips a dev warning
                ("Cannot specify a encType or method for a form that specifies a
                function as the action"). */}
            <FieldGrid
              as="form"
              action={addSpecialtyAction.bind(null, shopSlug, personId)}
              columns={2}
              className={sectionCardClass({
                className: "gap-y-3 sm:w-[32rem]",
              })}
            >
              <Field label={t("divers.certifications.agency")}>
                <select name="agency" className={controlClass}>
                  {Object.entries(AGENCY_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("divers.specialty.specialtyLabel")}>
                <select name="specialty" className={controlClass}>
                  {[
                    ...Object.entries(SPECIALTY_KEYS).map(
                      ([value, key]) => [value, t(key)] as const,
                    ),
                    ["nitrox", t("divers.specialty.nitroxOption")] as const,
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("divers.certifications.cardNumber")}>
                <input name="identifier" required className={controlClass} />
              </Field>
              <Field
                label={t("divers.certifications.refresherDue")}
                hint={t("divers.certifications.refresherHint")}
              >
                <input name="expiresOn" type="date" className={controlClass} />
              </Field>
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("divers.certifications.capturing")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("divers.specialty.captureForReview")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </div>
        </details>
        {sectionStatus ? (
          <div className="basis-full">
            <DiverFormStatus status={sectionStatus} shopSlug={shopSlug} locale={locale} />
          </div>
        ) : null}
      </div>
      {diver.specialtyCertifications.length === 0 && diver.nitroxCertifications.length === 0 ? (
        <EmptyState className="mt-4">
          <p className="text-sm text-muted">{t("divers.specialty.emptyState")}</p>
        </EmptyState>
      ) : (
        <ul
          className={sectionCardClass({
            padding: "none",
            className: "mt-4 divide-y divide-border",
          })}
        >
          {diver.specialtyCertifications.map((card) => {
            const display = heldCardDisplayStatus(card, todayLocal);
            const expired = display === "expired";
            // A card the diver typed on their own readiness link. This tap opens
            // a depth gate past 18 m, so it asks for the card in the staffer's
            // hand rather than taking the diver's word twice.
            const selfDeclared = isUnsightedSelfDeclaration(card);
            return (
              <li key={card.id} className="px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <CardStatusMark
                        tone={heldCardStatusTone(display)}
                        label={t(HELD_CARD_STATUS_KEYS[display])}
                      />
                      <span>
                        {t(AGENCY_KEYS[card.agency])} · {t(SPECIALTY_KEYS[card.specialty])}
                      </span>
                    </p>
                    <p className="mt-1 break-all text-sm text-muted">
                      {card.identifier}
                      {card.expiresAt ? (
                        <span className={expired ? "font-medium text-danger" : undefined}>
                          {expired
                            ? t("divers.certifications.refresherOverdue", {
                                date: formatCalendarDate(card.expiresAt),
                              })
                            : t("divers.certifications.refresherDueOn", {
                                date: formatCalendarDate(card.expiresAt),
                              })}
                        </span>
                      ) : null}
                      {isImportedCard(card) ? (
                        <span>
                          {" · "}
                          {card.importedFromLabel
                            ? t("divers.certifications.importedWithSource", {
                                source: card.importedFromLabel,
                              })
                            : t("divers.certifications.importedLabel")}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* One control, two labels — the same shape the level card
                        beside it has always had. An imported card's confirm no
                        longer opens a disclosure holding an attestation
                        checkbox (ADR 20260814-one-tap-imported-card-confirm). */}
                    {selfDeclared ? (
                      <CardSightingForm
                        t={t}
                        action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                        certificationId={card.id}
                        numberError={numberError}
                      />
                    ) : card.status === "pending" || needsImportConfirm(card) ? (
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <SubmitButton
                          pendingLabel={
                            needsImportConfirm(card)
                              ? t("divers.certifications.confirming")
                              : t("divers.certifications.markingCertified")
                          }
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {needsImportConfirm(card)
                            ? t("divers.certifications.confirmCard")
                            : t("divers.certifications.markCertified")}
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={deleteSpecialtyAction.bind(null, shopSlug, personId)}>
                      <input type="hidden" name="certificationId" value={card.id} />
                      {/* No confirm dialog: the delete lands and a toast offers a one-tap undo. */}
                      <SubmitButton
                        pendingLabel={t("divers.certifications.deleting")}
                        className={buttonClass({ variant: "danger", size: "sm" })}
                      >
                        {t("divers.certifications.delete")}
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
          {diver.nitroxCertifications.map((card) => {
            const display = heldCardDisplayStatus(card, todayLocal);
            // A nitrox tick from one of the public opt-in forms: no agency, no
            // number, and nobody has seen a card. This tap authorizes a gas
            // fill, so it asks for the card in the staffer's hand.
            const selfDeclared = isUnsightedSelfDeclaration(card);
            return (
              <li key={card.id} className="px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <CardStatusMark
                        tone={heldCardStatusTone(display)}
                        label={t(HELD_CARD_STATUS_KEYS[display])}
                      />
                      <span>
                        {selfDeclared
                          ? t("divers.specialty.nitroxLine")
                          : t("divers.specialty.nitroxAgencyLine", {
                              agency: t(AGENCY_KEYS[card.agency]),
                            })}
                      </span>
                    </p>
                    <p className="mt-1 break-all text-sm text-muted">
                      {selfDeclared
                        ? t("divers.certifications.selfDeclaredLabel")
                        : card.identifier}
                      {isImportedCard(card) ? (
                        <span>
                          {" · "}
                          {card.importedFromLabel
                            ? t("divers.certifications.importedWithSource", {
                                source: card.importedFromLabel,
                              })
                            : t("divers.certifications.importedLabel")}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selfDeclared ? (
                      <CardSightingForm
                        t={t}
                        action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                        certificationId={card.id}
                        cardType="nitrox"
                        numberError={numberError}
                      />
                    ) : card.status === "pending" || needsImportConfirm(card) ? (
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="cardType" value="nitrox" />
                        <SubmitButton
                          pendingLabel={
                            needsImportConfirm(card)
                              ? t("divers.certifications.confirming")
                              : t("divers.certifications.markingCertified")
                          }
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {needsImportConfirm(card)
                            ? t("divers.certifications.confirmCard")
                            : t("divers.certifications.markCertified")}
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={deleteSpecialtyAction.bind(null, shopSlug, personId)}>
                      <input type="hidden" name="certificationId" value={card.id} />
                      <input type="hidden" name="cardType" value="nitrox" />
                      {/* No confirm dialog: the delete lands and a toast offers a one-tap undo. */}
                      <SubmitButton
                        pendingLabel={t("divers.certifications.deleting")}
                        className={buttonClass({ variant: "danger", size: "sm" })}
                      >
                        {t("divers.certifications.delete")}
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
