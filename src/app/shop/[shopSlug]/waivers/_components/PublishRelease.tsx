"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { groupLabelClass } from "@/components/ui/ledger";

/**
 * **Materiality is a recorded choice, and then there is one act** (ADR
 * 20260827-people-not-lists, decision 4; the language is ADR
 * 20260827-clearwater-surface-language).
 *
 * What stood here was two same-weight buttons with no default — "Publish —
 * signatures need renewing" beside "Publish wording correction" — each arming
 * its own confirm. A staffer met two near-destructive controls and had to read
 * both labels to work out which one they meant, and whichever they pressed,
 * the app learned the answer from *which button was tapped* rather than from
 * anything they said.
 *
 * H-54 asks for two explicit choices, so the choice is now the input: a radio
 * pair the form cannot be submitted without, whose material option states its
 * own cost in standing signatures, and one **Publish** beneath. The count is
 * in front of the staffer before the tap either way — it always was (issue
 * #720) — but now it sits on the option they have to select rather than in a
 * message that appears after they have already decided.
 *
 * Three things this component owns, and `PublishRelease.test.tsx` pins each:
 *
 * - **No submit without a choice while signatures stand.** Both radios carry
 *   `required`, so the form is invalid until one is picked. That is the
 *   browser's own gate; `saveWaiverAction` re-checks server-side, because a
 *   POST straight at the action never met this component (ADR-0006).
 * - **The double tap survives on the material path only.** A wording
 *   correction costs nothing and gets no ceremony; a material publish
 *   invalidates every standing signature at once and keeps its second
 *   deliberate gesture (`InlineConfirm`), whose label repeats what it is about
 *   to cost. It takes `InlineConfirm`'s default `autoResetMs` — off. That
 *   option exists for a compact trigger with no visible way out (sign out, in
 *   a header menu); this one sits directly beneath the radio pair, and picking
 *   "a correction" replaces the armed button with a plain Publish, so the way
 *   out is on screen and one tap away. Escape and a blur already disarm it.
 *   A wall clock here bought nothing and cost determinism: the armed state is
 *   photographed (`waiver-materiality-choice` in `e2e/visual.spec.ts`), and a
 *   `setTimeout` runs on the runner's real clock — the e2e fleet freezes
 *   `Date`, not timers — so an 8-second arm was racing a two-viewport capture
 *   whose own budgets are measured in tens of seconds. Two baselines from one
 *   commit, and an armed/disarmed diff is exactly the kind a reviewer waves
 *   through.
 * - **With no standing signatures there is no choice to make.** Nothing is at
 *   risk, so the radios do not render and Publish stands alone — the same
 *   condition the old two-button fork used, kept exactly.
 *
 * The words all arrive from the server (`waiversStaff.publish.*`): staff copy
 * never crosses to the client, so a staff Client Component takes its words as
 * props (ADR 20260730-staff-copy-localization).
 */
export type PublishReleaseCopy = {
  /** The small-caps line over the pair — "This edit is". */
  choiceLegend: string;
  correction: string;
  correctionDetail: string;
  material: string;
  /**
   * What a material publish costs, already counted and pluralised by the
   * server: the standing-signature sentence, plus the boarding-soon one when
   * any of those divers are on a departure inside the operational horizon.
   */
  materialDetail: string;
  /** The one button. */
  action: string;
  /** Its armed label on the material path, carrying the count again. */
  confirm: string;
  pending: string;
};

/** The two answers `saveWaiverAction` accepts, and the only two this posts. */
type Materiality = "material" | "non-material";

function ChoiceRow({
  value,
  title,
  detail,
  checked,
  onChoose,
}: {
  value: Materiality;
  title: string;
  detail: string;
  checked: boolean;
  onChoose: (value: Materiality) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 border-t border-border py-3 last:border-b">
      <input
        type="radio"
        name="material"
        value={value}
        checked={checked}
        onChange={() => onChoose(value)}
        // The gate, in the platform: a radio group with nothing selected makes
        // the form invalid, so Publish cannot post a materiality the staffer
        // never stated. `saveWaiverAction` refuses the same shape again.
        required
        className="mt-1 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-base font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{detail}</span>
      </span>
    </label>
  );
}

export function PublishRelease({
  copy,
  standingSignatures,
}: {
  copy: PublishReleaseCopy;
  /**
   * Whether any signature stands against the current release. False on a
   * shop's first release, and on one nobody has signed yet — publishing then
   * costs nothing, so there is nothing to choose between.
   */
  standingSignatures: boolean;
}) {
  const [choice, setChoice] = useState<Materiality | null>(null);
  const publishClass = buttonClass({ size: "lg" });

  // A row wrapper on both branches, so the button keeps its own width inside
  // the column rather than stretching to the release textarea's.
  const publishButton = (
    <div className="flex flex-wrap items-center gap-3">
      <SubmitButton pendingLabel={copy.pending} className={publishClass}>
        {copy.action}
      </SubmitButton>
    </div>
  );

  if (!standingSignatures) return publishButton;

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="min-w-0">
        <legend className={groupLabelClass()}>{copy.choiceLegend}</legend>
        <div className="mt-2">
          <ChoiceRow
            value="non-material"
            title={copy.correction}
            detail={copy.correctionDetail}
            checked={choice === "non-material"}
            onChoose={setChoice}
          />
          <ChoiceRow
            value="material"
            title={copy.material}
            detail={copy.materialDetail}
            checked={choice === "material"}
            onChoose={setChoice}
          />
        </div>
      </fieldset>
      {choice === "material" ? (
        <div className="flex flex-wrap items-center gap-3">
          <InlineConfirm
            triggerLabel={copy.action}
            confirmLabel={copy.confirm}
            pendingLabel={copy.pending}
            triggerClassName={publishClass}
            // Armed, the button says what it is about to cost rather than
            // repeating "Publish" in a second colour — the word carries the
            // state, the tone only weights it.
            confirmClassName={buttonClass({ variant: "danger", size: "lg" })}
          />
        </div>
      ) : (
        publishButton
      )}
    </div>
  );
}
