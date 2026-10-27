import type { ComponentProps, ReactNode } from "react";
import { CertificationCardRow } from "@/components/person/rows";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { InsetGroup } from "@/components/ui/ledger";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  type CertificationCardKind,
  certificationCardRowState,
  isImportedCard,
  isShopIssuedCard,
  needsImportConfirm,
} from "@/lib/certification-cards";
import type { DiverStatusRow } from "@/lib/diver-status";
import { formatShortDate } from "@/lib/format";
import { isUnsightedSelfDeclaration, needsCardSighting } from "@/lib/readiness";
import {
  deleteCertificationAction,
  deleteSpecialtyAction,
  markCertifiedAction,
  reviewAction,
  reviewSpecialtyAction,
} from "../card-actions";
import { AddCertificationForm } from "./AddCertificationForm";
import { AgencyCheckLink } from "./AgencyCheckLink";
import { CardSightingForm } from "./CardSightingForm";
import { agencyCheckActions, levelCardCheck, listedChecks } from "./card-checks";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DrysuitExperienceRow } from "./DrysuitExperienceRow";
import { fileGap } from "./file-gap";
import { JuniorCardControl, JuniorCardStatus } from "./JuniorCardControl";
import { MarkCertifiedControl } from "./MarkCertifiedControl";
import { markCertifiedCopy } from "./mark-certified-copy";
import { NoCertificationRows } from "./NoCertificationRows";
import type { DiverNotice } from "./NoticeBanner";
import {
  AGENCY_KEYS,
  type CardAwaitingKind,
  cardAwaitingAnchor,
  type DiverProfile,
  type Shop,
} from "./shared";
import { onlyNotHeld, saysNotCertified, TripNeedsRow, tripNeedsLines } from "./trip-needs";

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
  rowAnchor,
}: {
  t: StaffTranslator;
  title: ReactNode;
  detail?: ReactNode;
  state: ReturnType<typeof certificationCardRowState>;
  imported?: { source?: string | null };
  actions: ReactNode;
  /** Set on the first card that is waiting for somebody, for the ledger's fix. */
  anchor?: boolean;
  /** Set on the first card of its kind waiting for somebody — see `cardAwaitingAnchor`. */
  rowAnchor?: string;
}) {
  return (
    <CertificationCardRow
      as="li"
      t={t}
      title={title}
      detail={detail}
      state={state}
      imported={imported}
      actions={actions}
      // The anchor is an attribute on the row's own action group, never a
      // wrapper around it: a wrapper that appears and disappears as the anchor
      // moves changes the subtree's element type, and React unmounts the
      // controls under it. Marking a card verified is what moves the anchor, so
      // that took the success toast and its Undo down with it.
      actionsId={anchor ? AWAITING_ANCHOR : undefined}
      rowId={rowAnchor}
    />
  );
}

/** What a card's mark-certified control shows: the import to confirm, the card waiting, or settled. */
function markState(card: {
  status: "pending" | "verified";
  importedAt: Date | null;
  reviewedAt: Date | null;
}) {
  return needsImportConfirm(card) ? "confirm" : card.status === "pending" ? "pending" : "settled";
}

/**
 * Under a nitrox or specialty card: the agency's link while it waits
 * (`awaiting`), and the agency's own words when it has any. A card an agency
 * check filed from the page's list (layer 3) carries them, and says where they
 * came from by its stamp (`listedFromCertificationId`), before and after Mark
 * certified: its note is the agency's words, never a staffer's.
 */
function PendingCardFoot({
  t,
  card,
  awaiting,
  check,
}: {
  t: StaffTranslator;
  card: {
    reviewNote: string | null;
    listedFromCertificationId: string | null;
    agency: keyof typeof AGENCY_KEYS;
  };
  awaiting: boolean;
  /**
   * The agency check, for a card the extension may check (issue #2592): the
   * link becomes a button when the extension is here. Rendered for a settled
   * card too, so a check that just certified it keeps its Undo toast.
   */
  check?: ComponentProps<typeof AgencyCheckLink>["check"];
}) {
  return (
    <>
      {check ? (
        <AgencyCheckLink agency={card.agency} t={t} check={check} />
      ) : awaiting ? (
        <AgencyCheckLink agency={card.agency} t={t} />
      ) : null}
      {card.listedFromCertificationId ? (
        <span className="block">
          {t("divers.certifications.listedByAgency", { agency: t(AGENCY_KEYS[card.agency]) })}
        </span>
      ) : null}
      {card.reviewNote ? <span className="block italic">{card.reviewNote}</span> : null}
    </>
  );
}

/**
 * A card an agency check listed with no number of its own (an agency that
 * numbers each card, its page showing none): confirmed through the sighting,
 * as an unsighted self-declaration is.
 */
function listedWithoutANumber(card: {
  status: "pending" | "verified";
  listedFromCertificationId: string | null;
  identifier: string | null;
}): boolean {
  return needsCardSighting({
    status: card.status,
    listedFromCertificationId: card.listedFromCertificationId,
    identifier: card.identifier,
  });
}

/** A no-break space, by code point, because a literal one is invisible in the source. */
const NBSP = String.fromCodePoint(0x00a0);

/**
 * **The one fact the closed door carries: what this diver is certified to do.**
 *
 * Every card on file in render order — level rungs first, then specialties,
 * then nitrox — joined the way a staffer reads a stack of cards at the desk.
 *
 * **Not the Certification summary** (`certificationSummaryText`, glossary), and
 * deliberately not: that phrase answers "what may this person dive" from one
 * rung plus a nitrox tick, for a row on the wait list or the deal list where it
 * is *all* the reader gets. This is the diver's own record, where the question
 * is which cards the shop holds — specialties included, and the agency named,
 * because a staffer standing at the desk with a stack of plastic is matching
 * them one to one. Two questions, two phrasings; they share their **words**
 * (`shared.certificationSummary.*`) so a claim can never be spelled two ways.
 *
 * **Every card is named through `certificationCardRowState`**, the same
 * function the rows inside the group render through, so the closed door and
 * the open one cannot disagree about a card. Three of its four values are
 * something other than "the shop has seen this":
 *
 * - `self_declared` and `pending` take the shared "— unverified" phrase. A
 *   hand-entered card still `pending` is the glossary's **claimed
 *   certification** — nobody has looked it up, and it never satisfies
 *   readiness until staff Mark certified — so a door reading it as a plain
 *   agency and level is the same failure the self-declared phrase exists to
 *   stop.
 * - `imported_unconfirmed` takes "— confirm to clear", the badge's own words
 *   (`divers.shared.cardStatus.confirmToClear`) in the wrapper this summary's
 *   list needs: the card came across already checked by the shop's previous
 *   system, and the dive or the fill waits on one tap.
 *
 * Any of the three turns the whole summary to warning ink — the treatment
 * `certificationSummaryUnchecked` earns everywhere else, and the reason the
 * glossary says such a card "must never be scanned as a plain level". The words
 * carry it on their own; the tone only has to stop contradicting them.
 *
 * A diver who has told the shop they hold nothing gets that sentence instead of
 * "None on file" — it is their own statement, and it is a different fact from
 * silence.
 */
function cardsOnFile(
  diver: DiverProfile,
  t: StaffTranslator,
  noCertificationDeclared: boolean,
): { text: string; tone: "muted" | "warning" } {
  let unchecked = false;
  const named = (
    kind: CertificationCardKind,
    value: string,
    card: Parameters<typeof certificationCardRowState>[1],
  ) => {
    const state = certificationCardRowState(kind, card);
    if (state === "verified") return value;
    unchecked = true;
    return state === "imported_unconfirmed"
      ? t("shared.certificationSummary.confirmToClear", { value })
      : t("shared.certificationSummary.selfDeclared", { value });
  };
  const cards = [
    ...diver.certifications.map((card) =>
      named(
        "level",
        card.agency === "other"
          ? t(CERTIFICATION_LEVEL_KEYS[card.level])
          : `${t(AGENCY_KEYS[card.agency])} ${t(CERTIFICATION_LEVEL_KEYS[card.level])}`,
        card,
      ),
    ),
    ...diver.specialtyCertifications.map((card) =>
      named("specialty", t(SPECIALTY_KEYS[card.specialty]), card),
    ),
    ...diver.nitroxCertifications.map((card) =>
      named("nitrox", t("shared.certificationSummary.nitrox"), card),
    ),
  ];
  if (cards.length > 0) {
    // **The fact wraps between cards, never inside one.** On a phone it takes
    // a line of its own and wraps where the width runs out, and a break inside
    // "Deep — confirm to clear" left a stray "clear" opening the next line,
    // read as the state of the card after it. Each phrase's spaces are
    // no-break, and so is the one before its "·", so the only break left is
    // after a separator (the trip log's `CertificationLine` joins the same
    // way). A phrase wider than the line still breaks: the door's
    // `max-sm:break-words`.
    return {
      text: cards.map((card) => card.replaceAll(" ", NBSP)).join(`${NBSP}· `),
      tone: unchecked ? "warning" : "muted",
    };
  }
  // "Not certified yet" is unverified too, and it is the row a staffer most
  // needs to catch before a two-tank charter goes out to it — the same reading
  // `certificationSummaryUnchecked` gives it.
  if (noCertificationDeclared) {
    return { text: t("shared.certificationSummary.notCertified"), tone: "warning" };
  }
  return { text: t("divers.file.certificationsNone"), tone: "muted" };
}

/**
 * Whether the door's own fact already names the gap, so `fileGap` adds only
 * its ink and departure. An unchecked card reads "— unverified" or "— confirm
 * to clear", which is every waiting-for-a-look row; an empty file reads "None
 * on file", which is the missing-card row. Anything else — a level below the
 * trip's, a specialty the trip needs — is a fact the list of cards cannot
 * carry, so the status sentence goes beneath it.
 */
function summarySaysGap(
  gap: DiverStatusRow | undefined,
  tone: "muted" | "warning",
  diver: DiverProfile,
): boolean {
  if (!gap) return true;
  if (!("blocker" in gap.sentence)) return tone === "warning";
  const code = gap.sentence.blocker.code;
  if (code === "certification_missing") {
    // Only the empty state says it: a Nitrox card alone is still no level,
    // and "Nitrox" in danger ink would read as a gas problem.
    return (
      diver.certifications.length === 0 &&
      diver.specialtyCertifications.length === 0 &&
      diver.nitroxCertifications.length === 0
    );
  }
  const waitingForALook =
    code.endsWith("_pending") ||
    code.endsWith("_self_declared") ||
    code === "specialty_import_unconfirmed";
  return waitingForALook && tone === "warning";
}

/**
 * **Quiet ink, not a bordered button.** A filled `danger` control stood on
 * every card row at rest — the loudest thing in the group a staffer reads to
 * decide whether somebody dives, and the one act on the row that is never the
 * reason they opened it. `danger-ghost` keeps the warning colour the rule
 * requires for a destructive control while dropping the border and the fill,
 * which is the same weight the record's note rows already use.
 *
 * No confirm dialog: the delete lands and a toast offers a one-tap undo.
 */
function deleteButton(
  t: StaffTranslator,
  action: (formData: FormData) => void,
  id: string,
  nitrox: boolean,
) {
  return (
    <form action={action}>
      <input type="hidden" name="certificationId" value={id} />
      {nitrox ? <input type="hidden" name="cardType" value="nitrox" /> : null}
      <SubmitButton
        pendingLabel={t("divers.certifications.deleting")}
        className={buttonClass({ variant: "danger-ghost", size: "sm" })}
      >
        {t("divers.certifications.delete")}
      </SubmitButton>
    </form>
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
  gap,
  canAssist = false,
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
  /** This group's own outcome, rendered beside its controls — never page-top. */
  status?: DiverNotice;
  /** The status row about this diver's cards, said by this row (`splitDiverStatus`). */
  gap?: DiverStatusRow;
  /** Assists are available for this shop (the add-a-card photo read). */
  canAssist?: boolean;
}) {
  // A refused card *number* belongs on the box it names, not in the group's
  // action row — and emphatically not opening the add-a-card form, which is a
  // different form entirely and had nothing to do with the submit.
  //
  // **On one box, not on every box of that kind.** A diver can hold two
  // self-declared cards, and `field` says only which *kind* of box the refusal
  // is about — so this opened every sighting disclosure on the record and
  // printed the same red sentence under each. `numberErrorFor` compares the id
  // the action refused (`?card=`); a refusal that names none is the older link
  // shape and still lands on the group's row rather than nowhere.
  const numberError = status?.field === "sighted-identifier" ? status.text : undefined;
  const numberErrorFor = (cardId: string) =>
    numberError && status?.cardId === cardId ? numberError : undefined;
  const groupStatus = numberError && status?.cardId ? undefined : status;

  const markCertified = markCertifiedCopy(t);
  const markCertify = markCertifiedAction.bind(null, shopSlug, personId);
  const agencyCheck = agencyCheckActions(shopSlug, personId);
  const listed = listedChecks(diver.person, shop, agencyCheck);
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

  const onFile = cardsOnFile(diver, t, noCertificationDeclared);
  // A card the diver does not hold reads as one fact on the row, and the
  // reasons wait behind the door (Aaron, 2026-10-23). The row stays in danger
  // ink with the departure it keeps them off, so the block is never quieter;
  // only the paragraph explaining it moved.
  // A card the fact already names (an empty file's "None on file") keeps the
  // fact alone; any other card not held makes the row say "Not certified",
  // even beside a card waiting for a look — that look clears only its own card.
  const summarySays = summarySaysGap(gap, onFile.tone, diver);
  const notCertified = saysNotCertified(gap) && !(summarySays && onlyNotHeld(gap));
  const missing = fileGap(gap, {
    t,
    locale,
    timezone: shop.timezone,
    factSaysIt: summarySays && !notCertified,
    says: notCertified ? t("divers.file.notCertified") : undefined,
  });

  // The first row anybody has to act on takes the ledger's anchor. Counted the
  // way the roster's badge and the status ledger count it, in render order, so
  // "Verify it" always lands on a row that has a control.
  let anchored = false;
  const claimAnchor = (awaiting: boolean) => {
    if (!awaiting || anchored) return false;
    anchored = true;
    return true;
  };
  // And the first of each *kind*, for a ledger row that is about one kind: a
  // blocker on the Advanced card must not land on a pending Deep card.
  const claimedKinds = new Set<CardAwaitingKind>();
  const claimKindAnchor = (awaiting: boolean, kind: CardAwaitingKind) => {
    if (!awaiting || claimedKinds.has(kind)) return undefined;
    claimedKinds.add(kind);
    return cardAwaitingAnchor(kind);
  };

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
        rowAnchor={claimKindAnchor(awaiting, "level")}
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
            {/* Rendered for a settled card too: a check that just certified
                it keeps its Undo toast through the re-render (`AgencyCheck`). */}
            <AgencyCheckLink
              agency={card.agency}
              t={t}
              check={{
                certificationId: card.id,
                awaiting: awaiting || needsImportConfirm(card),
                ...levelCardCheck(card, diver.person, shop, selfDeclared),
                ...agencyCheck,
              }}
            />
            {card.reviewNote ? <span className="block italic">{card.reviewNote}</span> : null}
            {card.reviewedAt && card.reviewedByName ? (
              <span className="block">
                {card.agencyCheckedAt && card.agency !== "other"
                  ? t("divers.certifications.checkedWithAgencyBy", {
                      agency: t(AGENCY_KEYS[card.agency]),
                      name: card.reviewedByName,
                      date: formatShortDate(card.reviewedAt, locale, shop.timezone),
                    })
                  : t("divers.certifications.verifiedBy", {
                      name: card.reviewedByName,
                      date: formatShortDate(card.reviewedAt, locale, shop.timezone),
                    })}
              </span>
            ) : null}
            <JuniorCardStatus card={card} t={t} />
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
                numberError={numberErrorFor(card.id)}
              />
            ) : (
              /* The settled control keeps its Undo toast mounted after review. */
              <MarkCertifiedControl
                action={markCertify}
                certificationId={card.id}
                cardType="level"
                state={markState(card)}
                copy={markCertified}
              />
            )}
            {card.status === "verified" ? (
              <JuniorCardControl
                {...{ card, shopSlug, personId, locale, timezone: shop.timezone, t }}
              />
            ) : null}
            {deleteButton(t, deleteLevel, card.id, false)}
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
        rowAnchor={claimKindAnchor(awaiting, card.specialty)}
        state={certificationCardRowState("specialty", card)}
        imported={isImportedCard(card) ? { source: card.importedFromLabel } : undefined}
        title={
          <>
            {t(AGENCY_KEYS[card.agency])} · {t(SPECIALTY_KEYS[card.specialty])}
          </>
        }
        detail={
          <>
            {card.identifier}
            <PendingCardFoot
              t={t}
              card={card}
              awaiting={awaiting}
              check={listed(card, { id: card.id, type: "specialty", kind: card.specialty })}
            />
          </>
        }
        actions={
          <>
            {selfDeclared || listedWithoutANumber(card) ? (
              <CardSightingForm
                t={t}
                action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                certificationId={card.id}
                numberError={numberErrorFor(card.id)}
              />
            ) : (
              <MarkCertifiedControl
                action={markCertify}
                certificationId={card.id}
                cardType="specialty"
                state={markState(card)}
                copy={markCertified}
              />
            )}
            {deleteButton(t, deleteSpecialty, card.id, false)}
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
        rowAnchor={claimKindAnchor(awaiting, "nitrox")}
        state={certificationCardRowState("nitrox", card)}
        imported={isImportedCard(card) ? { source: card.importedFromLabel } : undefined}
        title={
          selfDeclared
            ? t("divers.specialty.nitroxLine")
            : t("divers.specialty.nitroxAgencyLine", { agency: t(AGENCY_KEYS[card.agency]) })
        }
        detail={
          <>
            {selfDeclared ? null : card.identifier}
            {/* A self-declared nitrox card is the diver's word with no card
                sighted: its agency is often the "other" placeholder and its
                title drops the agency, so a lookup link would send the staffer
                to an agency nobody named. The sighted claim gets one. */}
            <PendingCardFoot
              t={t}
              card={card}
              awaiting={awaiting && !selfDeclared}
              check={
                selfDeclared
                  ? undefined
                  : listed(card, { id: card.id, type: "nitrox", kind: "nitrox" })
              }
            />
          </>
        }
        actions={
          <>
            {selfDeclared || listedWithoutANumber(card) ? (
              <CardSightingForm
                t={t}
                action={reviewSpecialtyAction.bind(null, shopSlug, personId)}
                certificationId={card.id}
                cardType="nitrox"
                numberError={numberErrorFor(card.id)}
              />
            ) : (
              <MarkCertifiedControl
                action={markCertify}
                certificationId={card.id}
                cardType="nitrox"
                state={markState(card)}
                copy={markCertified}
              />
            )}
            {deleteButton(t, deleteSpecialty, card.id, true)}
          </>
        }
      />,
    );
  }

  return (
    <DiverFileGroupDisclosure
      id="certifications"
      label={t("divers.certifications.heading")}
      // **The levels on file, not the queue state.** "None waiting" answered a
      // question nobody asked of a closed door. What a staffer wants off this
      // row is what this diver is certified to do; a gap the cards cannot
      // name (a trip that needs Deep) is `detail`, beneath it. An unsighted claim wears the shared "— unverified" phrase, so
      // the door cannot read as though the shop has seen a card it has not.
      summary={onFile.text}
      summaryTone={missing?.tone ?? onFile.tone}
      detail={missing?.detail}
      open={Boolean(status) || (Boolean(missing?.open) && !(notCertified && onlyNotHeld(gap)))}
      stacked
    >
      <InsetGroup
        // A list of cards is a list: each row is one record a staffer can act
        // on, so the shell is a `<ul>` and every row a real `<li>`. A screen
        // reader gets the count before it starts reading, which a run of
        // `<div>`s cannot give it.
        bodyAs="ul"
      >
        {notCertified ? <TripNeedsRow t={t} lines={tripNeedsLines(t, gap)} /> : null}
        {rows}
        <NoCertificationRows
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          t={t}
          declared={noCertificationDeclared}
          empty={rows.length === 0}
        />
        <DrysuitExperienceRow
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          t={t}
        />
        <AddCertificationForm
          t={t}
          shopSlug={shopSlug}
          personId={personId}
          groupStatus={groupStatus}
          canAssist={canAssist}
        />
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
