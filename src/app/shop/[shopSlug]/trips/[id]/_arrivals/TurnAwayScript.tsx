import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoicePill } from "@/components/ui/form";
import { RowActionForm } from "./RowActionForm";

/**
 * **"Turned away" — the desk saw this diver and would not board them**
 * (safety sheet 2026-10-15, item 6; H-128).
 *
 * The sibling of `NoShowScript`, in the same shape for the same reasons: a
 * native `<details>` at the foot of a blocked row, quiet when closed, one
 * confirm when open, every string a prop. What it adds is the reason, chosen
 * from this row's own blockers (`turnAwayReasons`, src/lib/turn-away.ts) and
 * only from them: the page passes the categories readiness shows, and the
 * writer refuses any other. A row with one reason has it chosen already.
 */
export type TurnAwayScriptCopy = {
  door: string;
  legend: string;
  consequence: string;
  confirm: string;
  confirming: string;
  /** Names the diver, so one row's confirm does not read like every other's. */
  confirmAriaLabel: string;
  sendFailed: string;
};

export function TurnAwayScript({
  action,
  bookingId,
  reasons,
  copy,
}: {
  action: (formData: FormData) => Promise<void>;
  bookingId: string;
  /** This row's reasons, each with its word: never empty (the page draws nothing then). */
  reasons: readonly { value: string; label: string }[];
  copy: TurnAwayScriptCopy;
}) {
  const only = reasons.length === 1;
  return (
    <details className="group/turn-away pb-2">
      <summary
        className={buttonClass({
          variant: "ghost",
          size: "sm",
          flush: true,
          className: "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {copy.door}
      </summary>
      <RowActionForm action={action} sendFailedLabel={copy.sendFailed}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <div className="mt-1 flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
          <ChoiceFieldset legend={copy.legend} required bodyClassName="flex flex-wrap gap-2">
            {reasons.map((reason) => (
              <ChoicePill
                key={reason.value}
                type="radio"
                name="reason"
                value={reason.value}
                required
                defaultChecked={only}
              >
                {reason.label}
              </ChoicePill>
            ))}
          </ChoiceFieldset>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="min-w-0 grow text-sm text-muted">{copy.consequence}</p>
            <SubmitButton
              pendingLabel={copy.confirming}
              ariaLabel={copy.confirmAriaLabel}
              observabilityAction="turn_away"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {copy.confirm}
            </SubmitButton>
          </div>
        </div>
      </RowActionForm>
    </details>
  );
}
