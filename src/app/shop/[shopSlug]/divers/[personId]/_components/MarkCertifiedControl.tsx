// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { MarkCertifiedResult } from "../actions";

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
 * **One card's "Mark certified" — the tap that does not reload the record.**
 *
 * It used to redirect. On a ~6,400px page with its own `loading.tsx` that meant
 * a full-page skeleton, a jump to the `#cards` anchor, and a banner two screens
 * from the row, once per card — for a staffer working down a stack of them at
 * the desk. Now the action revalidates and returns, so the row flips to
 * "Certified" where it sits.
 *
 * **The banner is a toast with an Undo instead.** "Certification marked
 * verified. It counts toward readiness." explained a status word the row was
 * already wearing, and offered nothing; a mis-tap on the wrong row had no way
 * back but deleting the card. The toast says less and gives the one thing that
 * was missing.
 *
 * It renders for a card that is already certified as well — with no button —
 * and that is load-bearing rather than tidy: the toast lives here, so the
 * component has to survive the re-render that takes its own button away.
 *
 * A card that needs a sighting never reaches this control (`CardSightingForm`
 * is that row's button); `markCertifiedAction` refuses one anyway, and refuses
 * to undo it, because a sighting rewrites the row from the card in the
 * staffer's hand and there is nothing to put back.
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
            intent: "undo",
          }}
          pendingLabel={copy.undoPending}
          undoLabel={copy.undo}
        />
      ) : null}
    </>
  );
}
