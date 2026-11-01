// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { useActionState, useState, useTransition } from "react";
import {
  AgencyListedOffer,
  agencyListedForm,
} from "@/app/shop/[shopSlug]/_components/agency-check/AgencyListedOffer";
import type { AgencyCheckCopy } from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-copy";
import {
  type AgencyCheckFailure,
  agencyCheckEvidence,
  agencyCheckFailure,
  agencyCheckForm,
  agencyCheckMatchedText,
  agencyCheckOutcomeText,
  agencyCheckSendsToAgency,
} from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-outcome";
import { reportFailedCheck } from "@/app/shop/[shopSlug]/_components/agency-check/report-failed-check";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { requestAgencyPage, useCertCheckExtension } from "@/components/useCertCheckExtension";
import type { AgencyCheckQuery } from "@/lib/agency-check";
import type { AgencyCheckResult, AgencyListedAddResult } from "../agency-check-actions";

export type { AgencyCheckCopy };

const LINK_CLASS = buttonClass({
  variant: "link",
  size: "sm",
  flush: true,
  busy: true,
  className: "mt-1 print:hidden",
});

/**
 * **"Check with SSI", done for the staffer when the DiveDay extension is here**
 * (H-20261008-cert-check-extension).
 *
 * Without the extension this is exactly the link it always was: the agency's
 * page in a new tab. With it, the same words become a button. The extension
 * looks the diver up on the agency's page in the background and hands back the
 * page's text; `agencyCheckAction` decides on the server whether that page
 * names this diver at this level, and certifies the card if it does. Every
 * other answer writes nothing and says what the agency's page showed. When
 * the next step is the agency's own page (it answered short of a match, asks
 * whether the staffer is human, has changed, or is not one this copy checks),
 * its link takes the button's place; a page that could not be read, or a
 * signed-out PADI, keeps the button for another try, with the link beside it.
 *
 * Like `MarkCertifiedControl`, it renders for a card that has just been
 * certified too, drawing nothing but the toast, because the toast's Undo has
 * to outlive the re-render that settles the row.
 */
export function AgencyCheck({
  href,
  query,
  certificationId,
  cardType,
  awaiting,
  action,
  addListed,
  copy,
  offNote,
}: {
  href: string;
  /** The lookup the extension types, or null when this card cannot be checked. */
  query: AgencyCheckQuery | null;
  certificationId: string;
  /** The table a nitrox or specialty card is in (issue #2592); absent for a level card. */
  cardType?: "nitrox" | "specialty";
  /** The card is still waiting for somebody to confirm it. */
  awaiting: boolean;
  /** `agencyCheckAction` bound to this shop and diver, on the server. */
  action: (previous: AgencyCheckResult, formData: FormData) => Promise<AgencyCheckResult>;
  /** `addAgencyListedCardsAction` bound to this shop and diver: the page's other cards (layer 3). */
  addListed?: (
    previous: AgencyListedAddResult,
    formData: FormData,
  ) => Promise<AgencyListedAddResult>;
  copy: AgencyCheckCopy;
  /**
   * "PADI checks are off for this shop…": said under the link when the
   * extension is here but the shop's switch keeps this agency's check off
   * (H-20261014-padi-divechek), so a staffer with the extension knows why there is no button.
   */
  offNote?: string;
}) {
  const hasExtension = useCertCheckExtension();
  const [result, formAction, judging] = useActionState(action, null);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<AgencyCheckFailure>(null);
  // The page the server judged, kept so a ticked offer posts the same text
  // and the server can judge it again.
  const [pageText, setPageText] = useState("");
  // Once the offer's cards are filed the page's text is dropped (S5); the
  // offer stays, saying so.
  const [listedAdded, setListedAdded] = useState(false);
  const [, startTransition] = useTransition();
  const busy = asking || judging;

  async function check() {
    if (!query) return;
    setAsking(true);
    setFailure(null);
    const reply = await requestAgencyPage(query);
    setAsking(false);
    if (!reply.ok) {
      reportFailedCheck(query.agency, reply);
      setFailure(agencyCheckFailure(reply.reason));
      return;
    }
    setPageText(reply.pageText);
    setListedAdded(false);
    const formData = agencyCheckForm(certificationId, reply.pageText, { cardType });
    startTransition(() => formAction(formData));
  }

  const link = (
    // buttonClass owns the target's size and inline-flex centering; this row
    // keeps that target below the credential instead of running into its text.
    <span className="flex">
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {copy.link}
      </a>
    </span>
  );
  const match = result?.ok && result.verdict === "match" ? result : null;
  const undo = match?.undo;
  const evidence = agencyCheckEvidence(result);
  const outcome = agencyCheckOutcomeText(
    result,
    failure,
    copy,
    query ? `${query.firstName} ${query.lastName}` : "",
  );
  const sendsToAgency = agencyCheckSendsToAgency(result, failure);

  return (
    <>
      {!awaiting ? null : hasExtension && query && !sendsToAgency ? (
        <span className="flex">
          <button
            type="button"
            onClick={check}
            disabled={busy}
            aria-busy={busy}
            className={LINK_CLASS}
          >
            {busy ? copy.checking : copy.check}
          </button>
        </span>
      ) : hasExtension && query && outcome ? null : (
        link
      )}
      {awaiting && hasExtension && !query && offNote ? (
        <span className="mt-1 block text-sm text-muted print:hidden">{offNote}</span>
      ) : null}
      {awaiting && outcome ? (
        <span className="mt-1 block">
          <FormStatus tone={result && !result.ok ? "danger" : "warning"}>{outcome}</FormStatus>
          {evidence ? <span className="mt-1 block italic">{evidence}</span> : null}
          {hasExtension && query ? link : null}
        </span>
      ) : null}
      {match?.offers && addListed && (pageText || listedAdded) ? (
        <AgencyListedOffer
          lead={copy.listedLead}
          offers={match.offers}
          copy={copy}
          add={async (kinds) => {
            const added = await addListed(null, agencyListedForm(certificationId, pageText, kinds));
            if (added?.ok) {
              setListedAdded(true);
              setPageText("");
            }
            return added;
          }}
        />
      ) : null}
      {undo ? (
        <UndoToast
          message={match ? agencyCheckMatchedText(match, copy) : copy.matched}
          action={formAction}
          fields={{
            certificationId: undo.certificationId,
            ...(cardType ? { cardType } : {}),
            intent: "undo",
          }}
          pendingLabel={copy.undoPending}
          undoLabel={copy.undo}
          dismissLabel={copy.dismiss}
          placement="inline"
        />
      ) : null}
    </>
  );
}
