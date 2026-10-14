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
} from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-outcome";
import { UndoToast } from "@/components/UndoToast";
import { FormStatus } from "@/components/ui/form";
import { requestAgencyPage, useCertCheckExtension } from "@/components/useCertCheckExtension";
import type { AgencyCheckQuery } from "@/lib/agency-check";
import type { AgencyCheckResult, AgencyListedAddResult } from "../card-actions";

export type { AgencyCheckCopy };

const LINK_CLASS =
  "mt-1 block w-fit text-sm font-semibold text-primary hover:underline print:hidden";

/**
 * **"Check with SSI", done for the staffer when the DiveDay extension is here**
 * (H-105).
 *
 * Without the extension this is exactly the link it always was: the agency's
 * page in a new tab. With it, the same words become a button. The extension
 * looks the diver up on the agency's page in the background and hands back the
 * page's text; `agencyCheckAction` decides on the server whether that page
 * names this diver at this level, and certifies the card if it does. Every
 * other answer writes nothing and puts the link back beside a sentence saying
 * what the agency's page showed.
 *
 * Like `MarkCertifiedControl`, it renders for a card that has just been
 * certified too, drawing nothing but the toast, because the toast's Undo has
 * to outlive the re-render that settles the row.
 */
export function AgencyCheck({
  href,
  query,
  certificationId,
  awaiting,
  action,
  addListed,
  copy,
}: {
  href: string;
  /** The lookup the extension types, or null when this card cannot be checked. */
  query: AgencyCheckQuery | null;
  certificationId: string;
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
      setFailure(agencyCheckFailure(reply.reason));
      return;
    }
    setPageText(reply.pageText);
    setListedAdded(false);
    const formData = agencyCheckForm(certificationId, reply.pageText);
    startTransition(() => formAction(formData));
  }

  const link = (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {copy.link}
    </a>
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

  return (
    <>
      {!awaiting ? null : hasExtension && query ? (
        <button
          type="button"
          onClick={check}
          disabled={busy}
          aria-busy={busy}
          className={`${LINK_CLASS} disabled:cursor-progress disabled:opacity-70`}
        >
          {busy ? copy.checking : copy.check}
        </button>
      ) : (
        link
      )}
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
          fields={{ certificationId: undo.certificationId, intent: "undo" }}
          pendingLabel={copy.undoPending}
          undoLabel={copy.undo}
        />
      ) : null}
    </>
  );
}
