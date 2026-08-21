import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard, sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import {
  addCertificationAction,
  clearNoCertificationAction,
  deleteCertificationAction,
  reviewAction,
} from "../actions";
import { CardSightingForm } from "./CardSightingForm";
import { CardStatusMark } from "./CardStatusMark";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import {
  AGENCY_KEYS,
  CARD_STATUS_KEYS,
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
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // A refused card *number* belongs on the box it names, not in this section's
  // action row — and emphatically not opening the add-a-card form, which is a
  // different form entirely and had nothing to do with the submit.
  const numberError = status?.field === "sighted-identifier" ? status.text : undefined;
  // Success is page feedback, not add-card feedback. In particular, the
  // Mark certified action returns here with a success notice; opening this
  // disclosure for it made the unrelated add-certification form appear to
  // have succeeded. Render the notice beside the cards, never inside the
  // popover, regardless of its tone.
  const sectionStatus = !numberError && status?.form === "cards" ? status : undefined;
  // The diver's own "I hold no card", still standing: set, never cleared by
  // staff, and not yet refuted by a card. `listCertificationSummaries` decides
  // the same thing for the send lists; here the list of cards below *is* the
  // refutation, so the third condition is read off it directly.
  const noCertificationDeclared =
    Boolean(diver.person.noCertificationDeclaredAt) &&
    !diver.person.noCertificationClearedAt &&
    !diver.certifications.some((card) => !isUnsightedSelfDeclaration(card)) &&
    !diver.nitroxCertifications.some((card) => !isUnsightedSelfDeclaration(card)) &&
    diver.specialtyCertifications.length === 0;
  return (
    <section className="mt-10" aria-labelledby="cards-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cards-heading" className="text-lg font-semibold">
            {t("divers.certifications.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.certifications.description")}</p>
        </div>
        <details className="relative ml-auto shrink-0">
          <summary className={`${buttonClass()} list-none [&::-webkit-details-marker]:hidden`}>
            {t("divers.certifications.addCard")}
          </summary>
          <div className="absolute top-full right-0 z-20 mt-2 max-w-[calc(100vw-2rem)]">
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
              {/* The ladder is agency-neutral by design, but the words on the
                  card are not: a staffer holding a CMAS 2★ or a BSAC Sports
                  Diver has to decide which rung it is, and the answer lived only
                  in the glossary. It belongs where the picking happens
                  (docs/product/glossary.md — CMAS, RAID, GUE). */}
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
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("divers.certifications.capturing")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("divers.certifications.captureForReview")}
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
      {noCertificationDeclared ? (
        /* **The one statement on this record a staffer could not correct.**
           `people.no_certification_declared_at` is written by two
           unauthenticated forms that resolve a person by shop + email, so for a
           diver the shop holds no card for, anybody with a name and an email
           address off a manifest can leave it here — and until this control the
           only way back was owner-only erasure of the whole record.

           Warning-toned and worded as the diver's word, the same way the claim
           on a card row below is, because it is exactly as weak. Clearing it
           takes the record to *silence*, never to "certified": there is no card
           anywhere in this control's path.

           The phrase itself comes from `shared.certificationSummary.notCertified`
           and is never respelled here — it is the same fact at the same strength
           the send lists render, and the first draft of this panel had already
           drifted from it in Spanish, in the locale nobody reads as closely.
           Only the words about the *control* are this namespace's own. */
        <SectionCard
          as="div"
          // `h3`: this section already owns the `h2` above it.
          titleAs="h3"
          title={t("shared.certificationSummary.notCertified")}
          description={t("divers.certifications.clearNoCertificationHint")}
          className="mt-4 border-warning/25 bg-warning/10"
          actions={
            <form action={clearNoCertificationAction.bind(null, shopSlug, personId)}>
              <SubmitButton
                pendingLabel={t("divers.certifications.clearingNoCertification")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("divers.certifications.clearNoCertification")}
              </SubmitButton>
            </form>
          }
        >
          {/* **This came back after somebody already corrected it.** A set
              `clearedByPersonId` beside a null `clearedAt` is the one state the
              plain panel above would render identically to a first-time answer —
              and the difference is exactly the signal a staffer needs, because
              it separates "somebody is looping this through the public form"
              from "the diver really did answer that". The public form is
              unauthenticated, so the loop is reachable by anyone holding this
              diver's name and email. */}
          {diver.person.noCertificationClearedByPersonId ? (
            <p className="text-sm text-muted">
              {t("divers.certifications.noCertificationRestated")}
            </p>
          ) : null}
        </SectionCard>
      ) : diver.person.noCertificationClearedAt ? (
        /* **A correction that leaves no mark is not a correction.** The panel
           above unmounts the moment it succeeds, so without this line the next
           staffer cannot see that this diver ever gave that answer, or that a
           colleague overrode it — only a full CSV export could answer, and that
           is behind the owner/manager export gate. An archived card keeps a
           visible row for the same reason.

           The actor name is resolved by `getDiverProfile`; this component only
           renders the prop, keeping `_components` database-free. */
        <p className="mt-4 text-sm text-muted">
          {t("divers.certifications.noCertificationClearedNote", {
            date: formatShortDate(diver.person.noCertificationClearedAt, locale, shop.timezone),
            name:
              diver.noCertificationClearedByName ??
              t("divers.certifications.noCertificationClearedByUnknown"),
          })}
        </p>
      ) : null}
      {diver.certifications.length === 0 ? (
        <EmptyState className="mt-4">
          <p className="text-sm text-muted">{t("divers.certifications.empty")}</p>
        </EmptyState>
      ) : (
        <ul
          className={sectionCardClass({
            padding: "none",
            className: "mt-4 divide-y divide-border",
          })}
        >
          {diver.certifications.map((card) => {
            const display = card.status;
            // A card the diver named for themselves on a public opt-in, which
            // nobody here has looked at yet. It is the weakest thing on this
            // list and reads that way: no agency, no number, and no one-tap
            // certify (ADR 20260814-self-declared-cards).
            const selfDeclared = isUnsightedSelfDeclaration(card);
            // A claim with **no number in it** — a diver who named a rung and
            // left the optional card boxes blank. That is a different thing
            // from a claim that carries a real agency and a real number (typed
            // into `/ready`, or beside the level on the booking form since
            // issue #630) and wears `selfDeclaredAt` only so the one-tap
            // promote below still demands a sighting. Keying the two lines
            // beneath on `selfDeclared` alone told a staffer reviewing a typed
            // card "no certification number yet" — while hiding the very number
            // they needed to check it against.
            const claimWithoutANumber = selfDeclared && !card.identifier;
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
                      {/* A claim carrying no number also carries no agency
                          (`other`, the enum's "unstated"), so naming one would
                          invent evidence: the level stands alone until a
                          staffer sights the real card. */}
                      {claimWithoutANumber ? null : <>{t(AGENCY_KEYS[card.agency])} · </>}
                      {t(CERTIFICATION_LEVEL_KEYS[card.level])}
                    </span>
                  </p>
                  <p className="mt-1 break-all text-sm text-muted">
                    {claimWithoutANumber
                      ? t("divers.certifications.selfDeclaredLabel")
                      : card.identifier}
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
                  {card.reviewedAt && card.reviewedByName ? (
                    <p className="mt-1 text-sm text-muted">
                      {t("divers.certifications.verifiedBy", {
                        name: card.reviewedByName,
                        date: formatShortDate(card.reviewedAt, locale, shop.timezone),
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selfDeclared ? (
                    <CardSightingForm
                      t={t}
                      action={reviewAction.bind(null, shopSlug, personId)}
                      certificationId={card.id}
                      claimedLevel={card.level}
                      numberError={numberError}
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
