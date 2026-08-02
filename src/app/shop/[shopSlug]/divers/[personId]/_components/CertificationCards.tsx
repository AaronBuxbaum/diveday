import { DigitalCardFlip } from "@/components/DigitalCardFlip";
import { EmptyState } from "@/components/EmptyState";
import { ImageFileInput } from "@/components/ImageFileInput";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { addCertificationAction, deleteCertificationAction, reviewAction } from "../actions";
import {
  AGENCY_KEYS,
  CARD_STATUS_KEYS,
  cardDisplayStatus,
  type DiverProfile,
  isImportedCard,
  needsImportConfirm,
  type Shop,
  statusTone,
} from "./shared";

export async function CertificationCards({
  diver,
  shopSlug,
  personId,
  shop,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  shop: Shop;
}) {
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  // Shared across every card on this diver. Per-card interpolated text (card
  // number, ID, aria-label) is built fresh per card below, in the .map — ICU
  // composes those server-side so word order stays correct per locale,
  // rather than concatenating a prefix/suffix on the client.
  const cardCopy = {
    diverLabel: t("divers.certifications.card.diverLabel"),
    statusVerified: t("divers.certifications.card.statusVerified"),
    statusRefresherDue: t("divers.certifications.card.statusRefresherDue"),
    statusPending: t("divers.certifications.card.statusPending"),
    noPhoto: t("divers.certifications.card.noPhoto"),
    certifiedByStaff: t("divers.certifications.card.certifiedByStaff"),
    refresherDueVerify: t("divers.certifications.card.refresherDueVerify"),
    awaitingVerification: t("divers.certifications.card.awaitingVerification"),
    secureLabel: t("divers.certifications.card.secureLabel"),
    openFullSize: t("divers.certifications.card.openFullSize"),
    uploadedAlt: t("divers.certifications.card.uploadedAlt"),
  };
  const uploadedPhotoText = t("divers.certifications.card.uploadedPhoto");
  const securityDetailsText = t("divers.certifications.card.securityDetails");
  return (
    <section className="mt-10" aria-labelledby="cards-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cards-heading" className="text-lg font-semibold">
            {t("divers.certifications.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.certifications.description")}</p>
        </div>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
            {t("divers.certifications.addCard")}
          </summary>
          {/* No `encType`: a function `action` is a server action, not a
              native form post — React builds the `FormData` (files intact)
              and ships it over its own transport, so the browser never reads
              this attribute. Setting it anyway just trips a dev warning
              ("Cannot specify a encType or method for a form that specifies a
              function as the action"). */}
          <FieldGrid
            as="form"
            action={addCertificationAction.bind(null, shopSlug, personId)}
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
            <Field label={t("divers.certifications.level")}>
              <select name="level" className={controlClass}>
                {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
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
                {t("divers.certifications.captureForReview")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </details>
      </div>
      {diver.certifications.length === 0 ? (
        <EmptyState className="mt-4">
          <p className="text-sm text-muted">{t("divers.certifications.empty")}</p>
        </EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {diver.certifications.map((card) => {
            const display = cardDisplayStatus(card, todayLocal);
            const expired = display === "expired";
            return (
              <li
                key={card.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {t(AGENCY_KEYS[card.agency])} · {t(CERTIFICATION_LEVEL_KEYS[card.level])}
                  </p>
                  <p className="mt-1 break-all text-sm text-muted">
                    {card.identifier}
                    {card.expiresAt ? (
                      <span className={expired ? "font-medium text-danger" : undefined}>
                        {t(
                          expired
                            ? "divers.certifications.refresherOverdue"
                            : "divers.certifications.refresherDueOn",
                          { date: formatCalendarDate(card.expiresAt) },
                        )}
                      </span>
                    ) : null}
                  </p>
                  {card.reviewNote ? (
                    <p className="mt-1 text-sm text-muted italic">{card.reviewNote}</p>
                  ) : null}
                  <details className="mt-2 group print:hidden">
                    <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
                      {t("divers.certifications.viewDigitalCard")}
                    </summary>
                    <DigitalCardFlip
                      fullName={diver.person.fullName}
                      agencyLabel={t(AGENCY_KEYS[card.agency])}
                      levelLabel={t(CERTIFICATION_LEVEL_KEYS[card.level])}
                      cardImageUrl={card.cardImageUrl}
                      verificationStatus={display}
                      copy={{
                        ...cardCopy,
                        cardNumberText: t("divers.certifications.card.cardNumberText", {
                          id: card.identifier,
                        }),
                        idText: t("divers.certifications.card.idText", { id: card.identifier }),
                        flipAriaLabel: t("divers.certifications.card.flipAriaLabel", {
                          level: t(CERTIFICATION_LEVEL_KEYS[card.level]),
                        }),
                        tapToFlipText: t("divers.certifications.card.tapToFlipText", {
                          target: card.cardImageUrl ? uploadedPhotoText : securityDetailsText,
                        }),
                      }}
                    />
                  </details>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(display)}>{t(CARD_STATUS_KEYS[display])}</Badge>
                  {isImportedCard(card) ? (
                    <Badge tone="neutral">
                      {card.importedFromLabel
                        ? t("divers.certifications.importedWithSource", {
                            source: card.importedFromLabel,
                          })
                        : t("divers.certifications.importedLabel")}
                    </Badge>
                  ) : null}
                  {card.status === "pending" || needsImportConfirm(card) ? (
                    <form action={reviewAction.bind(null, shopSlug, personId)}>
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
                  <form action={deleteCertificationAction.bind(null, shopSlug, personId)}>
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
