import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import { addCertificationAction, deleteCertificationAction, reviewAction } from "../actions";
import { CardSightingForm } from "./CardSightingForm";
import { CardStatusMark } from "./CardStatusMark";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
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
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  shop: Shop;
  /** This section's own outcome, rendered beside its controls, not page-top. */
  status?: DiverNotice;
}) {
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  return (
    <section className="mt-10" aria-labelledby="cards-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cards-heading" className="text-lg font-semibold">
            {t("divers.certifications.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.certifications.description")}</p>
        </div>
        {/* Opened by its own outcome: this form lives in a collapsed
            `<details>`, and an answer rendered inside a shut disclosure is
            worse than the page-top banner it replaces — invisible rather than
            merely far away. */}
        <details open={Boolean(status)}>
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
            {/* The ladder is agency-neutral by design, but the words on the
                card are not: a staffer holding a CMAS 2★ or a BSAC Sports
                Diver has to decide which rung it is, and the answer lived only
                in the glossary. It belongs where the picking happens
                (docs/product/glossary.md — CMAS, RAID, GUE). */}
            <Field
              label={t("divers.certifications.level")}
              description={
                <>
                  <span className="block">{t("divers.certifications.levelMapping")}</span>
                  <span className="mt-1 block">
                    {t("divers.certifications.levelMappingCaution")}
                  </span>
                </>
              }
            >
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
            <FieldActions>
              <SubmitButton
                pendingLabel={t("divers.certifications.capturing")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("divers.certifications.captureForReview")}
              </SubmitButton>
              <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
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
            // A card the diver named for themselves on a public opt-in, which
            // nobody here has looked at yet. It is the weakest thing on this
            // list and reads that way: no agency, no number, and no one-tap
            // certify (ADR 20260814-self-declared-cards).
            const selfDeclared = isUnsightedSelfDeclaration(card);
            return (
              <li
                key={card.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <CardStatusMark
                      tone={statusTone(display)}
                      label={t(CARD_STATUS_KEYS[display])}
                    />
                    <span>
                      {/* A self-declared row's agency is `other` because the
                          public form never asks — naming one would invent
                          evidence, so the level stands alone until a staffer
                          sights the real card. */}
                      {selfDeclared ? null : <>{t(AGENCY_KEYS[card.agency])} · </>}
                      {t(CERTIFICATION_LEVEL_KEYS[card.level])}
                    </span>
                  </p>
                  <p className="mt-1 break-all text-sm text-muted">
                    {selfDeclared ? t("divers.certifications.selfDeclaredLabel") : card.identifier}
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
                    {/* Provenance, on the line that already carries the card's
                        own small print — not a pill in the control row. Where
                        a card came from is a fact about the card, and it never
                        needed to be the same shape as a status. */}
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
                  {card.reviewNote ? (
                    <p className="mt-1 text-sm text-muted italic">{card.reviewNote}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selfDeclared ? (
                    <CardSightingForm
                      t={t}
                      action={reviewAction.bind(null, shopSlug, personId)}
                      certificationId={card.id}
                      claimedLevel={card.level}
                    />
                  ) : card.status === "pending" || needsImportConfirm(card) ? (
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
