"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addAgencyListedCards,
  agencyListedKindsHeld,
  certificationForAgencyCheck,
  certificationForAgencyOffer,
  listedCardForAgencyCheck,
  undoAgencyCheck,
} from "@/db/agency-check";
import { reviewNitroxCertification } from "@/db/nitrox";
import { reviewCertification, reviewSpecialtyCertification } from "@/db/readiness";
import { diveSpecialty } from "@/db/schema";
import {
  type AgencyListedKind,
  agencyListedCards,
  judgeAgencyListedCard,
  judgeAgencyPage,
  PAGE_TEXT_MAX_LENGTH,
} from "@/lib/agency-check";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { readForm } from "@/lib/form-parse";
import { requireDiverActionContext } from "./action-helpers";
import type { MarkCertifiedResult } from "./card-actions";
import { cardForm, cardIdFromForm } from "./card-form";

/**
 * What a check with the agency did, for the control that asked. A value, not a
 * redirect, for the same reason as {@link MarkCertifiedResult}.
 */
export type AgencyCheckResult =
  | null
  | {
      ok: true;
      /** The agency's page named this diver at this level, and the card is certified. */
      verdict: "match";
      /**
       * `certified` promoted a pending card; `confirmed` cleared an imported
       * card's gate. The words say which, as {@link MarkCertifiedResult}'s do.
       */
      effect: "certified" | "confirmed";
      undo?: { certificationId: string };
      /**
       * The diver's other cards the same page lists and the shop does not
       * hold, in the agency's words (`agencyListedCards`): offered, never
       * filed, until the staffer ticks them (`addAgencyListedCardsAction`).
       */
      offers?: readonly AgencyCheckOffer[];
    }
  | { ok: true; verdict: "undone" }
  | {
      ok: true;
      /**
       * The diver is on the page, short of a match: this level is not
       * (`level_unconfirmed`), the card is junior, limited or unfinished
       * (`limited_card`), or PADI shows a junior rating for a diver under 15
       * (`junior_under_15`). The staffer reads it, with the diver's own lines.
       */
      verdict: "level_unconfirmed" | "limited_card" | "junior_under_15";
      evidence: string;
      /**
       * Set when the card checked is a nitrox or specialty card (issue #2592):
       * "not at this level" is then "not this certification".
       */
      listedCard?: true;
    }
  | {
      ok: true;
      /**
       * Nobody found; a page that reads as no result; PADI listing several
       * divers; or someone by this name, never with this birth date or number.
       */
      verdict: "no_record" | "unreadable" | "several_records" | "namesake";
    }
  | { ok: false; reason: "invalid" | "not-undoable" };

/** One card the agency's page lists for this diver, as the staffer is offered it. */
export type AgencyCheckOffer = { kind: AgencyListedKind; words: string };

/**
 * **Certify a card from the agency's own page** (H-20261008-cert-check-extension).
 *
 * The DiveDay browser extension, in the staffer's own browser, typed this
 * diver into the agency's lookup page and handed back the page's text. The
 * verdict is decided here, from the card and diver as the database holds them
 * (`certificationForAgencyCheck`), never from anything the browser claims, and
 * `judgeAgencyPage` is narrow: only the diver's name beside the claimed
 * level's own wording certifies. Anything else returns a verdict and writes
 * nothing. A match certifies through the ordinary review, stamped
 * `agencyCheckedAt` with the agency's matching words as the note, and is
 * undone the way a one-tap review is.
 *
 * **One action wherever the check is pressed**: the diver record, a row on a
 * departure's Divers tab, a "certification pending" row on Today, and each
 * card of a departure's "Check all" (which is only this, one card at a time,
 * from the browser). So a write ends in `refresh()` as well as revalidating
 * the record: the page the staffer pressed it on is the one that has to
 * settle, and only the browser knows which page that is. A "Check all" posts
 * `refresh=later` on each card and refreshes the page once when the run ends,
 * so a departure is not re-rendered after every card it certifies. That field
 * changes only when the page repaints, never what is written.
 */
export async function agencyCheckAction(
  shopSlug: string,
  personId: string,
  _previous: AgencyCheckResult,
  formData: FormData,
): Promise<AgencyCheckResult> {
  const fields = readForm(cardForm, formData);
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  if (!certificationId) return { ok: false, reason: "invalid" };
  const shopId = staff.user.shopId;
  // The table the card is in: the level ladder unless the form names a nitrox
  // or specialty card (issue #2592). Anything else is a hand-built post.
  const checkedKind = z
    .enum(["level", "nitrox", "specialty"])
    .safeParse(fields.cardType ?? "level");
  if (!checkedKind.success) return { ok: false, reason: "invalid" };
  const cardType = checkedKind.data === "level" ? undefined : checkedKind.data;

  if (fields.intent === "undo") {
    // Only the review a check made, on this diver: never a sighting or a
    // one-tap review, which have their own Undo. The cards its page listed
    // that still wait for Mark certified go with it (layer 3).
    const undone = await undoAgencyCheck(db, {
      shopId,
      personId,
      certificationId,
      undoneByPersonId: staff.user.personId,
      cardType,
    });
    revalidatePath(base);
    refresh();
    return undone.ok ? { ok: true, verdict: "undone" } : { ok: false, reason: "not-undoable" };
  }

  const pageText = fields.pageText;
  if (typeof pageText !== "string") return { ok: false, reason: "invalid" };
  if (cardType) {
    return agencyCheckListedCard(context, {
      cardType,
      certificationId,
      pageText,
      refresh: fields.refresh !== "later",
    });
  }
  const card = await certificationForAgencyCheck(db, { shopId, personId, certificationId });
  if (!card) return { ok: false, reason: "invalid" };
  const judged = judgeAgencyPage({
    ...card.query,
    ...card.identity,
    level: card.level,
    // A junior rating's age is read on the earliest calendar day anywhere,
    // so a diver is never taken for 15 a day early.
    today: calendarDateInTimezone(nowDate(), "Etc/GMT+12"),
    pageText: pageText.slice(0, PAGE_TEXT_MAX_LENGTH),
  });
  if (
    judged.verdict === "level_unconfirmed" ||
    judged.verdict === "limited_card" ||
    judged.verdict === "junior_under_15"
  ) {
    return { ok: true, verdict: judged.verdict, evidence: judged.evidence };
  }
  if (judged.verdict !== "match") return { ok: true, verdict: judged.verdict };

  const outcome = await reviewCertification(db, {
    shopId,
    certificationId,
    status: "verified",
    reviewedByPersonId: staff.user.personId,
    reviewNote: judged.evidence,
    agencyChecked: true,
  });
  revalidatePath(base);
  if (fields.refresh !== "later") refresh();
  if (!outcome.ok) return { ok: false, reason: "invalid" };
  // The page's other cards for this diver, offered and never filed here. A
  // card with no number on file has none to lend them, so it offers nothing.
  const offers = card.identity.cardNumber
    ? agencyListedCards({
        ...card.query,
        ...card.identity,
        level: card.level,
        today: calendarDateInTimezone(nowDate(), "Etc/GMT+12"),
        pageText: pageText.slice(0, PAGE_TEXT_MAX_LENGTH),
        held: await agencyListedKindsHeld(db, { shopId, personId }),
      }).map(({ kind, words }) => ({ kind, words }))
    : [];
  return {
    ok: true,
    verdict: "match",
    // An imported card was already `verified` on arrival: the agency's page
    // confirmed it rather than certifying it.
    effect: outcome.certification.importedAt ? "confirmed" : "certified",
    undo: { certificationId },
    ...(offers.length > 0 ? { offers } : {}),
  };
}

/**
 * **The agency check of one nitrox or specialty card** (issue #2592): the
 * level check's rule on the other two card tables. The card and diver are read
 * again from the database (`listedCardForAgencyCheck`), the page is judged by
 * the closed per-agency wording for this kind (`judgeAgencyListedCard`), and
 * only a page that lists the card for this diver under the card's number
 * certifies it, through the ordinary review stamped `agencyCheckedAt`. A
 * match offers nothing further and files nothing: the page's other cards are
 * a level card's to offer.
 */
async function agencyCheckListedCard(
  context: Awaited<ReturnType<typeof requireDiverActionContext>>,
  input: {
    cardType: "nitrox" | "specialty";
    certificationId: string;
    pageText: string;
    refresh: boolean;
  },
): Promise<AgencyCheckResult> {
  const { base, db, staff, personId } = context;
  const shopId = staff.user.shopId;
  const card = await listedCardForAgencyCheck(db, {
    shopId,
    personId,
    certificationId: input.certificationId,
    cardType: input.cardType,
  });
  if (!card) return { ok: false, reason: "invalid" };
  const judged = judgeAgencyListedCard({
    ...card.query,
    ...card.identity,
    kind: card.kind,
    today: calendarDateInTimezone(nowDate(), "Etc/GMT+12"),
    pageText: input.pageText.slice(0, PAGE_TEXT_MAX_LENGTH),
  });
  if (
    judged.verdict === "level_unconfirmed" ||
    judged.verdict === "limited_card" ||
    judged.verdict === "junior_under_15"
  ) {
    return { ok: true, verdict: judged.verdict, evidence: judged.evidence, listedCard: true };
  }
  if (judged.verdict !== "match") return { ok: true, verdict: judged.verdict };

  const reviewed = {
    shopId,
    certificationId: input.certificationId,
    status: "verified",
    reviewedByPersonId: staff.user.personId,
    reviewNote: judged.evidence,
    agencyChecked: true,
  } as const;
  const outcome =
    input.cardType === "nitrox"
      ? await reviewNitroxCertification(db, reviewed)
      : await reviewSpecialtyCertification(db, reviewed);
  revalidatePath(base);
  if (input.refresh) refresh();
  if (!outcome.ok) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    verdict: "match",
    // An imported card was already `verified` on arrival: the agency's page
    // confirmed it rather than certifying it.
    effect: outcome.certification.importedAt ? "confirmed" : "certified",
    undo: { certificationId: input.certificationId },
  };
}

const agencyListedKindSchema = z.enum(["nitrox", ...diveSpecialty.enumValues]);

/** What filing the page's other cards did, for the panel that asked. */
export type AgencyListedAddResult = null | { ok: true; added: AgencyListedKind[] } | { ok: false };

/**
 * **File the other cards the agency's page lists, as pending** (layer 3 of
 * the agency check, ADR 20261008-cert-check-extension).
 *
 * After a match the staffer is offered the diver's nitrox and specialty cards
 * the same page shows, and ticks the ones to keep. Nothing the browser sends
 * is believed but the page's text and the ticks: the card the check matched
 * is read again from the database (this shop, this diver, certified by an
 * agency check), the page is judged again and must still match, and the offer
 * is derived again from it. Every tick must name a kind that offer holds, or
 * nothing is filed, so a forged or replayed tick cannot make a card the page
 * did not show, or a second copy of one the diver holds.
 *
 * The cards land `pending` with the agency's words as their review note, for
 * a staffer's one-tap confirm: a nitrox card authorizes a fill and a
 * specialty opens a site, so the page alone never certifies them.
 */
export async function addAgencyListedCardsAction(
  shopSlug: string,
  personId: string,
  _previous: AgencyListedAddResult,
  formData: FormData,
): Promise<AgencyListedAddResult> {
  const fields = readForm(cardForm, formData);
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const pageText = fields.pageText;
  const kinds = z.array(agencyListedKindSchema).min(1).safeParse(formData.getAll("kind"));
  if (!certificationId || typeof pageText !== "string" || !kinds.success) return { ok: false };
  const ticked = new Set(kinds.data);
  if (ticked.size !== kinds.data.length) return { ok: false };
  const shopId = staff.user.shopId;

  const card = await certificationForAgencyOffer(db, { shopId, personId, certificationId });
  if (!card) return { ok: false };
  const offered = agencyListedCards({
    ...card.query,
    ...card.identity,
    level: card.level,
    today: calendarDateInTimezone(nowDate(), "Etc/GMT+12"),
    pageText: pageText.slice(0, PAGE_TEXT_MAX_LENGTH),
    held: card.held,
  });
  const chosen = offered.filter((offer) => ticked.has(offer.kind));
  if (chosen.length !== ticked.size) return { ok: false };

  const added = await addAgencyListedCards(db, {
    shopId,
    personId,
    certificationId,
    filedByPersonId: staff.user.personId,
    cards: chosen,
  });
  if (!added.ok) return { ok: false };
  revalidatePath(base);
  refresh();
  return { ok: true, added: added.added };
}
