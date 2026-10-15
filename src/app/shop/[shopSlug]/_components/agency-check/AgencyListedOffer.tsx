// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { type ReactNode, useId, useState } from "react";
import type {
  AgencyCheckOffer,
  AgencyListedAddResult,
} from "@/app/shop/[shopSlug]/divers/[personId]/card-actions";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";
import { ChoiceRow, FormStatus } from "@/components/ui/form";
import type { AgencyListedKind } from "@/lib/agency-check";
import type { AgencyCheckCopy } from "./agency-check-copy";

/** The words the offer renders, from one agency's copy. */
export type AgencyListedOfferCopy = Pick<
  AgencyCheckCopy,
  "listedAdd" | "listedAdding" | "listedAdded" | "listedFailed"
>;

/**
 * What a panel posts: `addAgencyListedCardsAction`, given the card the check
 * matched, the page's text the check judged, and the ticks. The server judges
 * the page again and files only kinds its own offer holds.
 */
export function agencyListedForm(
  certificationId: string,
  pageText: string,
  kinds: readonly AgencyListedKind[],
): FormData {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  formData.set("pageText", pageText);
  for (const kind of kinds) formData.append("kind", kind);
  return formData;
}

/**
 * **"PADI also shows these certifications. Add them?"** (layer 3 of the
 * agency check). After a match, the diver's other cards the same page lists,
 * one tick each, all ticked. Adding files them as pending, with the agency's
 * words, for a staffer's Mark certified: never certified from here.
 *
 * Shown on the diver record under the card the check certified, on a
 * departure's Divers tab under the diver's row (after a "Check all" has
 * finished, never during it), and on Today under the Needs you list, naming
 * the diver with a link to their record, because the diver's row may have
 * left with the card it was about.
 */
export function AgencyListedOffer({
  lead,
  offers,
  copy,
  add,
}: {
  /** "PADI also shows these certifications. Add them? …", already filled in; on Today, with a link. */
  lead: ReactNode;
  offers: readonly AgencyCheckOffer[];
  copy: AgencyListedOfferCopy;
  add: (kinds: AgencyListedKind[]) => Promise<AgencyListedAddResult>;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<AgencyListedKind>>(
    () => new Set(offers.map((offer) => offer.kind)),
  );
  const [phase, setPhase] = useState<"open" | "adding" | "added" | "failed">("open");
  const leadId = useId();

  if (phase === "added") {
    return (
      <div className="mt-2 text-sm print:hidden">
        <FormStatus tone="success">{copy.listedAdded}</FormStatus>
      </div>
    );
  }

  async function submit() {
    const kinds = offers.map((offer) => offer.kind).filter((kind) => ticked.has(kind));
    if (kinds.length === 0) return;
    setPhase("adding");
    let result: AgencyListedAddResult;
    try {
      result = await add(kinds);
    } catch {
      result = { ok: false };
    }
    setPhase(result?.ok ? "added" : "failed");
  }

  return (
    <fieldset
      aria-labelledby={leadId}
      className={`mt-2 ${INSET_NOTE_BOX} border border-border bg-surface-sunken print:hidden`}
      data-agency-listed-offer=""
    >
      <p id={leadId}>{lead}</p>
      {offers.map((offer) => (
        <ChoiceRow
          key={offer.kind}
          type="checkbox"
          name="kind"
          value={offer.kind}
          checked={ticked.has(offer.kind)}
          disabled={phase === "adding"}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            setTicked((previous) => {
              const next = new Set(previous);
              if (checked) next.add(offer.kind);
              else next.delete(offer.kind);
              return next;
            });
          }}
        >
          {offer.words}
        </ChoiceRow>
      ))}
      <button
        type="button"
        onClick={submit}
        disabled={phase === "adding" || ticked.size === 0}
        aria-busy={phase === "adding"}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {phase === "adding" ? copy.listedAdding : copy.listedAdd}
      </button>
      {phase === "failed" ? (
        <div className="mt-1">
          <FormStatus tone="danger">{copy.listedFailed}</FormStatus>
        </div>
      ) : null}
    </fieldset>
  );
}
