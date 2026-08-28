import type { ReactNode } from "react";
import { CertificationCardRow } from "@/components/person/rows";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  certificationCardRowState,
  isImportedCard,
  isShopIssuedCard,
  needsImportConfirm,
} from "@/lib/certification-cards";
import { formatShortDate } from "@/lib/format";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import {
  addCardAction,
  clearNoCertificationAction,
  deleteCertificationAction,
  deleteSpecialtyAction,
  markCertifiedAction,
  reviewAction,
  reviewSpecialtyAction,
} from "../actions";
import { CardSightingForm } from "./CardSightingForm";
import { MarkCertifiedControl } from "./MarkCertifiedControl";
import { markCertifiedCopy } from "./mark-certified-copy";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import { AGENCY_KEYS, type DiverProfile, type Shop } from "./shared";

/**
 * **Every card this diver holds, as one group** (ADR 20260827-people-not-lists,
 * decision 1: "Certifications (all three kinds as one group of card rows, one
 * add flow)").
 *
 * It replaces `CertificationCards` and `SpecialtyCards` — ~660 lines of
 * near-identical markup that put a level card and a specialty card in two
 * separate sections with two separate add buttons, two empty states and two
 * spellings of the same row. A staffer verifying a stack of cards at the desk
 * was reading one list in two places, and the ladder they were checking (level,
 * then the specialties it unlocks) ran across the boundary.
 *
 * The row itself is the shared `CertificationCardRow` (8a), so "verify a card"
 * looks identical here, on the counter and on a trip roster; the four-state
 * badge table and the H-24 rule about an imported card's gate live once, in
 * `src/lib/certification-cards.ts` and `src/i18n/card-labels.ts`, and are
 * deliberately not re-derived here.
 *
 * **One add flow, one select.** The two forms asked different questions
 * (agency + level + number; agency + specialty + number) and the SPEC's "kind
 * select" would have needed a field that appears and disappears as the select
 * moves — a client component, or a CSS trick, for a form the front desk fills
 * in twice a week. Instead the *card* is the one question: an option list
 * grouped into levels and specialties, which is how a staffer holding a card
 * reads it anyway. `addCardAction` splits the value and lands it in the right
 * table.
 */

/** The anchor the status ledger's "Verify it" lands on — see `STATUS_TARGET_ANCHORS`. */
const AWAITING_ANCHOR = "card-awaiting";

/**
 * The one card row every kind renders through, so the three tables cannot
 * drift into three shapes. `state` is `certificationCardRowState`'s — computed
 * once, in the domain layer, because flattening the two display unions is
 * exactly where H-24 gets lost.
 */
function CardRow({
  t,
  title,
  detail,
  state,
  imported,
  actions,
  anchor,
}: {
  t: StaffTranslator;
  title: ReactNode;
  detail?: ReactNode;
  state: ReturnType<typeof certificationCardRowState>;
  imported?: { source?: string | null };
  actions: ReactNode;
  /** Set on the first card that is waiting for somebody, for the ledger's fix. */
  anchor?: boolean;
}) {
  return (
    <CertificationCardRow
      as="li"
      t={t}
      title={title}
      detail={detail}
      state={state}
      imported={imported}
      actions={
        anchor ? (
          // `tabIndex` so a fragment link both scrolls here *and* puts the
          // cursor beside the control — the status ledger's whole promise.
          <span id={AWAITING_ANCHOR} tabIndex={-1} className="flex flex-wrap items-center gap-2">
            {actions}
          </span>
        ) : (
          actions
        )
      }
    />
  );
}

export function CertificationsGroup({
  diver,
  shop,
  shopSlug,
  personId,
  locale,
  t,
  status,
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
  /** This group's own outcome, rendered beside its controls — never page-top. */
  status?: DiverNotice;
}) {
  // A refused card *number* belongs on the box it names, not in the group's
  // action row — and emphatically not opening the add-a-card form, which is a
  // different form entirely and had nothing to do with the submit.
  const numberError = status?.field === "sighted-identifier" ? status.text : undefined;
  const groupStatus = numberError ? undefined : status;
  const markCertified = markCertifiedCopy(t);
  const markCertify = markCertifiedAction.bind(null, shopSlug, personId);
  const deleteLevel = deleteCertificationAction.bind(null, shopSlug, personId);
  const deleteSpecialty = deleteSpecialtyAction.bind(null, shopSlug, personId);
  // The diver's own "I hold no card", still standing: set, never cleared by
  // staff, and not yet refuted by a card the shop holds.
  const noCertificationDeclared =
    Boolean(diver.person.noCertificationDeclaredAt) &&
    !diver.person.noCertificationClearedAt &&
    !diver.certifications.some((card) => !isUnsightedSelfDeclaration(card)) &&
    !diver.nitroxCertifications.some((card) => !isUnsightedSelfDeclaration(card)) &&
    diver.specialtyCertifications.length === 0;

  // The first row anybody has to act on takes the ledger's anchor. Counted the
  // way the roster's badge and the status ledger count it, in render order, so
  // "Verify it" always lands on a row that has a control.
  let anchored = false;
  const claimAnchor = (awaiting: boolean) => {
    if (!awaiting || anchored) return false;
    anchored = true;
    return true;
  };

  function deleteButton(action: (formData: FormData) => void, id: string, nitrox: boolean) {
    return (
      <form action={action}>
        <input type="hidden" name="certificationId" value={id} />
        {nitrox ? <input type="hidden" name="cardType" value="nitrox" /> : null}
        {/* No confirm dialog: the delete lands and a toast offers a one-tap undo. */}
        <SubmitButton
          pendingLabel={t("divers.certifications.deleting")}
          className={buttonClass({ variant: "danger", size: "sm" })}
        >
          {t("divers.certifications.delete")}
        </SubmitButton>
      </form>
    );
  }

  const rows: ReactNode[] = [];

  for (const card of diver.certifications) {
    const selfDeclared = isUnsightedSelfDeclaration(card);
    const claimWithoutANumber = selfDeclared && !card.identifier;
    const declaredNumber = selfDeclared ? card.declaredIdentifier : null;
    const shopIssuedWithoutANumber = isShopIssuedCard(card) && !card.identifier;
    const awaiting = selfDeclared || card.status === "pending";
    rows.push(
      <CardRow
        key={`level:${card.id}`}
        t={t}
        anchor={claimAnchor(awaiting)}
        state={certificationCardRowState("level", card)}
        imported={isImportedCard(card) ? { source: card.importedFromLabel } : undefined}
        title={
          <>
            {/* `other` is the enum's "unstated", and naming it beside a level
                would read as an agency somebody gave. */}
            {card.agency === "other" ? null : <>{t(AGENCY_KEYS[card.agency])} · </>}
            {t(CERTIFICATION_LEVEL_KEYS[card.level])}
          </>
        }
        detail={
          <>
            {/* Three states, exclusive on purpose. A number the diver typed
                says "diver says <number>" — the provenance and the evidence in
                one phrase. A claim with nothing at all still says so. Anything
                else is a number the shop holds. */}
            {declaredNumber
              ? t("divers.certifications.declaredNumber", { number: declaredNumber })
              : claimWithoutANumber
                ? t("divers.certifications.selfDeclaredLabel")
                : shopIssuedWithoutANumber
                  ? t("divers.certifications.shopIssuedNoNumberLabel")
                  : card.identifier}
            {isShopIssuedCard(card) ? <> · {t("divers.certifications.shopIssuedLabel")}</> : null}
            {card.reviewNote ? <span className="block italic">{card.reviewNote}</span> : null}
            {card.reviewedAt && card.reviewedByName ? (
              <span className="block">
                {t("divers.certifications.verifiedBy", {
                  name: card.reviewedByName,
                  date: formatShortDate(card.reviewedAt, locale, shop.timezone),
                })}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {selfDeclared ? (
              <CardSightingForm
                t={t}
                action={reviewAction.bind(null, shopSlug, personId)}
                certificationId={card.id}
                claimedLevel={card.level}
                numberError={numberError}
              />
            ) : (
              /* Rendered for a settled card too, where it draws no button: the
                 toast lives inside it, so it has to outlive the re-render that
                 takes its own button away. */
              <MarkCertifiedControl
                action={markCertify}
                certificationId={card.id}
                cardType="level"
                state={
                  needsImportConfirm(card)
                    ? "confirm"
                    : card.status === "pending"
                      ? "pending"
                      : "settled"
                }
                copy={markCertified}
              />
            )}
            {deleteButton(deleteLevel, card.id, false)}
          </>
        }
      />,
    );
  }

  for (const card of diver.specialtyCertifications) {
    const selfDeclared = isUnsightedSelfDeclaration(card);
    const awaiting = selfDeclared || card.status === "pending" || needsImportConfirm(card);
    rows.push(
      <CardRow
        key={`specialty:${card.id}`}
        t={t}
        anchor={claimAnchor(awaiting)}
        state={certificationCardRowState("specialty", card)}
        imported={isImportedCard(card) ? { source: card.importedFromLabel } : undefined}
        title={
          <>
            {t(AGENCY_KEYS[card.agency])} · {t(SPECIALTY_KEYS[card.specialty])}
          </>
        }
        detail={card.identifier}
        actions={
          <>
            {selfDeclared ? (
              <CardSightingForm
                t={t}
                action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                certificationId={card.id}
                numberError={numberError}
              />
            ) : (
              <MarkCertifiedControl
                action={markCertify}
                certificationId={card.id}
                cardType="specialty"
                state={
                  needsImportConfirm(card)
                    ? "confirm"
                    : card.status === "pending"
                      ? "pending"
                      : "settled"
                }
                copy={markCertified}
              />
            )}
            {deleteButton(deleteSpecialty, card.id, false)}
          </>
        }
      />,
    );
  }

  for (const card of diver.nitroxCertifications) {
    const selfDeclared = isUnsightedSelfDeclaration(card);
    const awaiting = selfDeclared || card.status === "pending" || needsImportConfirm(card);
    rows.push(
      <CardRow
        key={`nitrox:${card.id}`}
        t={t}
        anchor={claimAnchor(awaiting)}
        state={certificationCardRowState("nitrox", card)}
        imported={isImportedCard(card) ? { source: card.importedFromLabel } : undefined}
        title={
          selfDeclared
            ? t("divers.specialty.nitroxLine")
            : t("divers.specialty.nitroxAgencyLine", { agency: t(AGENCY_KEYS[card.agency]) })
        }
        detail={selfDeclared ? t("divers.certifications.selfDeclaredLabel") : card.identifier}
        actions={
          <>
            {selfDeclared ? (
              <CardSightingForm
                t={t}
                action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                certificationId={card.id}
                cardType="nitrox"
                numberError={numberError}
              />
            ) : (
              <MarkCertifiedControl
                action={markCertify}
                certificationId={card.id}
                cardType="nitrox"
                state={
                  needsImportConfirm(card)
                    ? "confirm"
                    : card.status === "pending"
                      ? "pending"
                      : "settled"
                }
                copy={markCertified}
              />
            )}
            {deleteButton(deleteSpecialty, card.id, true)}
          </>
        }
      />,
    );
  }

  return (
    <section className="mt-10" aria-labelledby="certifications">
      <InsetGroup
        as="h2"
        // A list of cards is a list: each row is one record a staffer can act
        // on, so the shell is a `<ul>` and every row a real `<li>`. A screen
        // reader gets the count before it starts reading, which a run of
        // `<div>`s cannot give it.
        bodyAs="ul"
        id="certifications"
        label={t("divers.certifications.heading")}
        className="scroll-mt-24"
      >
        {rows}
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
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
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
          </div>
        ) : null}
        {rows.length === 0 && !noCertificationDeclared ? (
          <p className="px-5 py-4 text-sm text-muted sm:px-6">{t("divers.certifications.empty")}</p>
        ) : null}
        {/* **A correction that leaves no mark is not a correction.** The panel
            above unmounts the moment it succeeds, so without this line the next
            staffer cannot see that this diver ever gave that answer, or that a
            colleague overrode it. */}
        {!noCertificationDeclared && diver.person.noCertificationClearedAt ? (
          <p className="px-5 py-4 text-sm text-muted sm:px-6">
            {t("divers.certifications.noCertificationClearedNote", {
              date: formatShortDate(diver.person.noCertificationClearedAt, locale, shop.timezone),
              name:
                diver.noCertificationClearedByName ??
                t("divers.certifications.noCertificationClearedByUnknown"),
            })}
          </p>
        ) : null}
        <div className="px-5 py-3 sm:px-6">
          <details className="group">
            <summary
              className={buttonClass({
                variant: "link",
                size: "sm",
                flush: true,
                className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              })}
            >
              {t("divers.certifications.addCard")}
              <DisclosureCaret direction="down" className="group-open:rotate-180" />
            </summary>
            {/* No `encType`: a function `action` is a server action, not a
                native form post — React builds the `FormData` and ships it over
                its own transport, so the browser never reads that attribute. */}
            <FieldGrid
              as="form"
              action={addCardAction.bind(null, shopSlug, personId)}
              columns={2}
              className={sectionCardClass({ className: "mt-3 gap-y-3" })}
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
              {/* One question, not two: a staffer holding a card reads what it
                  is, and the ladder and the specialties are the same list to
                  them. The `<optgroup>`s are what keeps a rung from reading as
                  a specialty. */}
              <Field label={t("divers.certifications.cardLabel")}>
                <select name="card" className={controlClass} defaultValue="level:open_water">
                  <optgroup label={t("divers.certifications.cardKindLevel")}>
                    {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                      <option key={value} value={`level:${value}`}>
                        {t(key)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t("divers.certifications.cardKindSpecialty")}>
                    {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                      <option key={value} value={`specialty:${value}`}>
                        {t(key)}
                      </option>
                    ))}
                    <option value="nitrox">{t("divers.specialty.nitroxOption")}</option>
                  </optgroup>
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
          </details>
          <DiverFormStatus status={groupStatus} className="mt-3" />
        </div>
      </InsetGroup>
    </section>
  );
}
