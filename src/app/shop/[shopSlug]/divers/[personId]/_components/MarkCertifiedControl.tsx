// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { MarkCertifiedResult } from "../card-actions";

/**
 * Every word this control renders, translated on the server ahead of it —
 * staff client components take their words as props and never translate
 * (ADR 20260730-staff-copy-localization).
 */
export type MarkCertifiedCopy = {
  markCertified: string;
  markingCertified: string;
  confirmCard: string;
  confirming: string;
  /** The toast, by what the tap actually did. */
  certifiedToast: string;
  confirmedToast: string;
  undo: string;
  undoPending: string;
  dismiss: string;
  /** The refusals `markCertifiedAction` can answer with. */
  sightingRequired: string;
  duplicateCard: string;
  invalid: string;
  undoFailed: string;
};

function refusalText(result: MarkCertifiedResult, copy: MarkCertifiedCopy): string | undefined {
  if (!result || result.ok) return undefined;
  if (result.reason === "sighting-required") return copy.sightingRequired;
  if (result.reason === "duplicate-card") return copy.duplicateCard;
  if (result.reason === "not-undoable") return copy.undoFailed;
  return copy.invalid;
}

/**
 * Row-local Mark certified control. Keep it mounted after the action settles
 * so its Undo toast remains available. Cards requiring a sighting use another
 * control and are refused server-side here.
 */
export function MarkCertifiedControl({
  action,
  certificationId,
  cardType,
  state,
  copy,
}: {
  /** `markCertifiedAction` bound to this shop and diver, on the server. */
  action: (previous: MarkCertifiedResult, formData: FormData) => Promise<MarkCertifiedResult>;
  certificationId: string;
  cardType: "level" | "specialty" | "nitrox";
  /**
   * What this row is offering: promoting a pending card, confirming an
   * imported one, or — once it is settled — nothing but the toast.
   */
  state: "pending" | "confirm" | "settled";
  copy: MarkCertifiedCopy;
}) {
  const [result, formAction] = useActionState(action, null);
  const refusal = refusalText(result, copy);
  const undo = result?.ok && result.effect !== "undone" ? result.undo : undefined;

  return (
    <>
      {state === "settled" ? null : (
        <form action={formAction}>
          <input type="hidden" name="certificationId" value={certificationId} />
          <input type="hidden" name="cardType" value={cardType} />
          <SubmitButton
            pendingLabel={state === "confirm" ? copy.confirming : copy.markingCertified}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {state === "confirm" ? copy.confirmCard : copy.markCertified}
          </SubmitButton>
        </form>
      )}
      {/* A success needs no sentence — the row's own status mark changed. Only
          a refusal does, and it belongs on the row it is about. */}
      {refusal ? (
        <FormStatus tone="danger" className="basis-full">
          {refusal}
        </FormStatus>
      ) : null}
      {undo ? (
        /* Undo posts back through the same action, so putting the card back
           lands in this row's own status region rather than anywhere else. */
        <UndoToast
          message={
            result?.ok && result.effect === "confirmed" ? copy.confirmedToast : copy.certifiedToast
          }
          action={formAction}
          fields={{
            certificationId: undo.certificationId,
            cardType: undo.cardType,
            reviewedAt: undo.reviewedAt,
            intent: "undo",
          }}
          pendingLabel={copy.undoPending}
          undoLabel={copy.undo}
          dismissLabel={copy.dismiss}
        />
      ) : null}
    </>
  );
}
