// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { useActionState, useState, useTransition } from "react";
import { UndoToast } from "@/components/UndoToast";
import { FormStatus } from "@/components/ui/form";
import { requestAgencyPage, useCertCheckExtension } from "@/components/useCertCheckExtension";
import type { AgencyCheckQuery } from "@/lib/agency-check";
import type { AgencyCheckResult } from "../actions";

/** Every word this control renders, translated on the server with the agency's name in it. */
export type AgencyCheckCopy = {
  /** The link's own words, which the button keeps: "Check with SSI". */
  check: string;
  checking: string;
  matched: string;
  levelUnconfirmed: string;
  noRecord: string;
  unreadable: string;
  invalid: string;
  undo: string;
  undoPending: string;
  undoFailed: string;
};

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
  copy: AgencyCheckCopy;
}) {
  const hasExtension = useCertCheckExtension();
  const [result, formAction, judging] = useActionState(action, null);
  const [asking, setAsking] = useState(false);
  const [extensionFailed, setExtensionFailed] = useState(false);
  const [, startTransition] = useTransition();
  const busy = asking || judging;

  async function check() {
    if (!query) return;
    setAsking(true);
    setExtensionFailed(false);
    const reply = await requestAgencyPage(query);
    setAsking(false);
    if (!reply.ok) {
      setExtensionFailed(true);
      return;
    }
    const formData = new FormData();
    formData.set("certificationId", certificationId);
    formData.set("pageText", reply.pageText);
    startTransition(() => formAction(formData));
  }

  const link = (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {copy.check}
    </a>
  );
  const undo = result?.ok && result.verdict === "match" ? result.undo : undefined;
  const outcome = extensionFailed
    ? copy.unreadable
    : !result
      ? null
      : !result.ok
        ? result.reason === "not-undoable"
          ? copy.undoFailed
          : copy.invalid
        : result.verdict === "level_unconfirmed"
          ? copy.levelUnconfirmed
          : result.verdict === "no_record"
            ? copy.noRecord
            : result.verdict === "unreadable"
              ? copy.unreadable
              : null;

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
          {result?.ok && result.verdict === "level_unconfirmed" ? (
            <span className="mt-1 block italic">{result.evidence}</span>
          ) : null}
          {hasExtension && query ? link : null}
        </span>
      ) : null}
      {undo ? (
        <UndoToast
          message={copy.matched}
          action={formAction}
          fields={{ certificationId: undo.certificationId, intent: "undo" }}
          pendingLabel={copy.undoPending}
          undoLabel={copy.undo}
        />
      ) : null}
    </>
  );
}
