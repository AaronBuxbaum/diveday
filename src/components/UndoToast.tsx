"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { ToastShell } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";

/**
 * A land-then-undo toast: the action already happened, and this offers a few
 * seconds to take it back — the delight-first alternative to a blocking
 * "are you sure?" for reversible staff actions (docs delight backlog). It is
 * driven by the redirect that carries the undo target in the URL, auto-dismisses
 * after a beat, and its Undo submits a bound server action. Deliberately generic:
 * pass any inverse action plus the hidden fields it needs.
 *
 * The shared `ToastShell` with an Undo inside it, so the countdown pauses while
 * a reader's mouse or keyboard focus is in the toast (including the Undo
 * button) and resumes from wherever it left off once they leave.
 */
export function UndoToast({
  message,
  action,
  fields,
  pendingLabel,
  undoLabel,
  // Deliberately clear of Playwright's 8s expect timeout (playwright.config.ts)
  // so any render delay can't make the toast vanish out from under an assertion
  // racing to see it — that collision produced exactly this failure signature.
  autoDismissMs = 12000,
}: {
  message: string;
  action: (formData: FormData) => void;
  fields: Record<string, string>;
  pendingLabel: string;
  undoLabel: string;
  autoDismissMs?: number;
}) {
  // `ps-4 pe-1`, not `px-4`: Undo's own `px-3` supplies the rest of the end
  // inset, so the word ends 16px inside the toast as the message starts 16px
  // inside it. Both sides at `px-4` put Undo 7px further in (pixel-craft K-102).
  return (
    <ToastShell
      autoDismissMs={autoDismissMs}
      pausable
      className="flex items-center gap-4 py-3 ps-4 pe-1"
    >
      <span className="text-sm font-medium">{message}</span>
      <form action={action}>
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {/* The shared link button at `sm`: a 44px target with the press and
            the pointer every button has. It was hand-rolled at 52×36, under
            the floor (pixel-craft K-347). `busy`: a SubmitButton disables
            itself while its own undo is in flight. Its ring is drawn inside
            its box: the toast's `pe-1` leaves 4px of room at the end, and the
            outset ring's 5px ran over the toast's border (K-102). */}
        <SubmitButton
          pendingLabel={pendingLabel}
          className={buttonClass({
            variant: "link",
            size: "sm",
            busy: true,
            className: "focus-visible:focus-ring-inset",
          })}
        >
          {undoLabel}
        </SubmitButton>
      </form>
    </ToastShell>
  );
}
