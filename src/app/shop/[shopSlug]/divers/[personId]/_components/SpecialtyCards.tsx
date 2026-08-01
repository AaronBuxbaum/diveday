import { EmptyState } from "@/components/EmptyState";
import { ImageFileInput } from "@/components/ImageFileInput";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { addSpecialtyAction, deleteSpecialtyAction, reviewSpecialtyAction } from "../actions";
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
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  shop: Shop;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="specialty-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="specialty-heading" className="text-lg font-semibold">
            {t("divers.specialty.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.specialty.description")}</p>
        </div>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
            {t("divers.specialty.addSpecialty")}
          </summary>
          <FieldGrid
            as="form"
            action={addSpecialtyAction.bind(null, shopSlug, personId)}
            encType="multipart/form-data"
            columns={2}
            className="mt-3 gap-y-3 rounded-lg border border-border bg-surface p-4 sm:w-[32rem]"
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
                  ...Object.entries(SPECIALTY_KEYS).map(([value, key]) => [value, t(key)] as const),
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
            <Field
              label={t("divers.certifications.cardPhoto")}
              hint={t("divers.certifications.cardPhotoHint")}
              className="sm:col-span-2"
            >
              <ImageFileInput
                name="cardImage"
                copy={{
                  wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                  tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                }}
              />
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
        </details>
      </div>
      {diver.specialtyCertifications.length === 0 && diver.nitroxCertifications.length === 0 ? (
        <EmptyState className="mt-4">
          <p className="text-sm text-muted">{t("divers.specialty.emptyState")}</p>
        </EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {diver.specialtyCertifications.map((card) => {
            const display = heldCardDisplayStatus(card, todayLocal);
            const expired = display === "expired";
            return (
              <li key={card.id} className="px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {t(AGENCY_KEYS[card.agency])} · {t(SPECIALTY_KEYS[card.specialty])}
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
                    </p>
                    {card.cardImageUrl ? (
                      <a
                        href={card.cardImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        {t("divers.specialty.viewCardPhoto")}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={heldCardStatusTone(display)}>
                      {t(HELD_CARD_STATUS_KEYS[display])}
                    </Badge>
                    {isImportedCard(card) ? (
                      <Badge tone="neutral">
                        {card.importedFromLabel
                          ? t("divers.certifications.importedWithSource", {
                              source: card.importedFromLabel,
                            })
                          : t("divers.certifications.importedLabel")}
                      </Badge>
                    ) : null}
                    {card.status === "pending" && !needsImportConfirm(card) ? (
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <SubmitButton
                          pendingLabel={t("divers.certifications.markingCertified")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {t("divers.certifications.markCertified")}
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
                {/* Below the row, not inside the badge group: the panel is a
                      paragraph of text, and expanding it must not shove the
                      card's own title around. */}
                {needsImportConfirm(card) ? (
                  <ConfirmImportedCard
                    action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                    certificationId={card.id}
                    confirmationText={t("divers.specialty.confirmDisclosure", {
                      what: t("divers.specialty.whatSpecialtyDive", {
                        specialty: t(SPECIALTY_KEYS[card.specialty]),
                      }),
                    })}
                    t={t}
                  />
                ) : null}
              </li>
            );
          })}
          {diver.nitroxCertifications.map((card) => {
            const display = heldCardDisplayStatus(card, todayLocal);
            return (
              <li key={card.id} className="px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {t("divers.specialty.nitroxAgencyLine", {
                        agency: t(AGENCY_KEYS[card.agency]),
                      })}
                    </p>
                    <p className="mt-1 break-all text-sm text-muted">{card.identifier}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={heldCardStatusTone(display)}>
                      {t(HELD_CARD_STATUS_KEYS[display])}
                    </Badge>
                    {isImportedCard(card) ? (
                      <Badge tone="neutral">
                        {card.importedFromLabel
                          ? t("divers.certifications.importedWithSource", {
                              source: card.importedFromLabel,
                            })
                          : t("divers.certifications.importedLabel")}
                      </Badge>
                    ) : null}
                    {card.status === "pending" && !needsImportConfirm(card) ? (
                      <form action={reviewSpecialtyAction.bind(null, shopSlug, personId)}>
                        <input type="hidden" name="certificationId" value={card.id} />
                        <input type="hidden" name="cardType" value="nitrox" />
                        <SubmitButton
                          pendingLabel={t("divers.certifications.markingCertified")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {t("divers.certifications.markCertified")}
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
                {needsImportConfirm(card) ? (
                  <ConfirmImportedCard
                    action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                    certificationId={card.id}
                    cardType="nitrox"
                    confirmationText={t("divers.specialty.confirmDisclosure", {
                      what: t("divers.specialty.whatNitroxFill"),
                    })}
                    t={t}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The confirm for an imported specialty or nitrox card. Unlike "Mark certified"
 * — which already means a staffer looked the number up with the agency — this tap
 * is the *only* thing standing between a spreadsheet cell and the dive or fill it
 * authorizes, so it states what the staffer is asserting instead of being a bare
 * button (H-24, `dive-domain-expert` review). Same shape as the paper waiver's
 * medical attestation: a disclosure, a required checkbox naming the claim, then
 * the submit. The server refuses without the checkbox too, so this is a prompt,
 * not the enforcement.
 *
 * Deliberately per-card and deliberately not offered in bulk: a "confirm all"
 * would be the same unlabelled tap this replaces, times twelve.
 */
function ConfirmImportedCard({
  action,
  certificationId,
  cardType,
  confirmationText,
  t,
}: {
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  action: (formData: FormData) => void | Promise<void>;
  certificationId: string;
  cardType?: "nitrox";
  confirmationText: string;
  t: StaffTranslator;
}) {
  return (
    <details>
      <summary
        className={buttonClass({
          variant: "secondary",
          size: "sm",
          className: "cursor-pointer list-none",
        })}
      >
        {t("divers.certifications.confirmCard")}
      </summary>
      <form
        action={action}
        className="mt-2 max-w-sm rounded-lg border border-border bg-surface-sunken/50 p-3"
      >
        <input type="hidden" name="certificationId" value={certificationId} />
        {cardType ? <input type="hidden" name="cardType" value={cardType} /> : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="cardSighted" required className="mt-1 size-4 shrink-0" />
          <span>{confirmationText}</span>
        </label>
        <SubmitButton
          pendingLabel={t("divers.certifications.confirming")}
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
        >
          {t("divers.certifications.confirmCard")}
        </SubmitButton>
      </form>
    </details>
  );
}
