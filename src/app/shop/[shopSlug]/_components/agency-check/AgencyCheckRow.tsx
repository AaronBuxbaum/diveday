// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import { agencyListedOffers, useAgencyCheckHost } from "./AgencyCheckHost";
import { AgencyListedOffer } from "./AgencyListedOffer";
import {
  agencyCheckEvidence,
  agencyCheckMatchedText,
  agencyCheckOutcomeText,
  agencyCheckSendsToAgency,
} from "./agency-check-outcome";

const LINK_BUTTON = buttonClass({
  variant: "link",
  size: "sm",
  flush: true,
  className: "disabled:cursor-progress disabled:opacity-70",
});

/**
 * **"Check with SSI" on one diver's row** — a departure's Divers tab, or a
 * "certification pending" row on Today (H-20261008-cert-check-extension).
 *
 * Draws nothing without the DiveDay browser extension: the row's own door to
 * the diver's record is the way to the card then, as it always was. With it,
 * each card the extension can check gets the diver record's own button, and
 * the row keeps what the check came to — the agency's words when it was
 * anything short of a match, with the link to the agency's own page where it
 * answered, or, for a card a departure's "Check all" certified, that card's
 * own Undo.
 *
 * Every state lives in `AgencyCheckHost`, above the rows, because the row
 * re-renders without a card the moment it is certified.
 */
export function AgencyCheckRow({
  personId,
  cards,
  align = "start",
}: {
  personId: string;
  /** This diver's cards the extension can check now (`listAgencyCheckableCards`). */
  cards: readonly AgencyCheckableCard[];
  /** `end` in a Today row's fix slot, where the control sits at the row's edge. */
  align?: "start" | "end";
}) {
  const host = useAgencyCheckHost();
  if (!host) return null;
  const pendingIds = new Set(cards.map((card) => card.certificationId));
  // The cards still waiting, then any this page checked that have since
  // settled and left the list: their outcome, or their Undo, stays.
  const shown = [
    ...cards,
    ...Object.values(host.cards).filter(
      (card) =>
        card.personId === personId &&
        !pendingIds.has(card.certificationId) &&
        host.states[card.certificationId] !== undefined,
    ),
  ];
  if (shown.length === 0) return null;
  const items = shown
    .map((card) => {
      const copy = host.copies[card.agency];
      const state = host.states[card.certificationId];
      const settled = state?.phase === "settled" ? state : null;
      const match =
        settled?.result?.ok === true && settled.result.verdict === "match" ? settled.result : null;
      const matched = match !== null;
      // The agency's page answered, short of a match (or came back without
      // this diver on it), asked whether the staffer is human, or has
      // changed: the next step is the staffer on the agency's own page, so
      // the link takes the button's place rather than standing under it with
      // the same words. A check that came back with no page keeps the button,
      // for another try.
      const answered = settled ? agencyCheckSendsToAgency(settled.result, settled.failure) : false;
      const showButton =
        host.hasExtension && pendingIds.has(card.certificationId) && !matched && !answered && copy;
      const outcome =
        settled && copy
          ? agencyCheckOutcomeText(
              settled.result,
              settled.failure,
              copy,
              `${card.query.firstName} ${card.query.lastName}`,
            )
          : null;
      const evidence = settled ? agencyCheckEvidence(settled.result) : null;
      // A "Check all" leaves each certified card its own Undo on the row; a
      // single check's Undo is its toast, as on the diver record.
      const rowUndo = match && settled?.via === "all" ? match : null;
      // The page's other cards for this diver (layer 3), under the row; never
      // while a "Check all" is still running, which nothing interrupts.
      const offers =
        host.offersAt === "row" && host.queue.phase !== "running"
          ? agencyListedOffers(state)
          : null;
      if (!copy || (!showButton && !outcome && !rowUndo && !offers)) return null;
      return (
        <div
          key={card.certificationId}
          className={align === "end" ? "flex flex-col items-end" : undefined}
        >
          {showButton ? (
            <button
              type="button"
              onClick={() => host.checkOne(card)}
              disabled={host.busy}
              aria-busy={state?.phase === "checking"}
              className={LINK_BUTTON}
            >
              {state?.phase === "checking"
                ? copy.checking
                : card.kind
                  ? copy.checkKind[card.kind]
                  : copy.check}
            </button>
          ) : null}
          {outcome && settled ? (
            // The page's words and the agency's link are for the desk, not a
            // printed roster: a printout carries the card's state, not this.
            <div className="mt-1 text-sm print:hidden">
              <FormStatus tone={settled.result && !settled.result.ok ? "danger" : "warning"}>
                {outcome}
              </FormStatus>
              {evidence ? <span className="mt-1 block italic">{evidence}</span> : null}
              {answered ? (
                <a
                  href={copy.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={LINK_BUTTON}
                >
                  {copy.link}
                </a>
              ) : null}
            </div>
          ) : null}
          {rowUndo ? (
            <form
              action={() => host.undo(card)}
              className="flex flex-wrap items-center gap-x-3 text-sm print:hidden"
            >
              <span className="text-success-strong">{agencyCheckMatchedText(rowUndo, copy)}</span>
              <SubmitButton pendingLabel={copy.undoPending} className={LINK_BUTTON}>
                {copy.undo}
              </SubmitButton>
            </form>
          ) : null}
          {offers ? (
            <AgencyListedOffer
              lead={copy.listedLead}
              offers={offers}
              copy={copy}
              add={(kinds) => host.addListed(card, kinds)}
            />
          ) : null}
        </div>
      );
    })
    .filter((item) => item !== null);
  if (items.length === 0) return null;
  return <div className={align === "end" ? "flex flex-col items-end" : "mt-1"}>{items}</div>;
}
