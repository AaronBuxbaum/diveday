"use client";

import { useState } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { ToastShell } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";

/**
 * A land-then-undo toast: the action already happened, and this keeps the
 * reversal available until staff act on it — the delight-first alternative
 * to a blocking "are you sure?" for reversible staff actions. It is driven by
 * the redirect that carries the undo target; Undo submits a bound server action
 * and Dismiss clears the notice. Pass any inverse action and its hidden fields.
 *
 * The shared `ToastShell` stays until the inverse action is taken. A transient
 * acknowledgement must not carry the only control that can reverse a write.
 */
export function UndoToast({
  message,
  action,
  fields,
  pendingLabel,
  undoLabel,
  dismissLabel,
  placement = "fixed",
}: {
  message: string;
  action: (formData: FormData) => void;
  fields: Record<string, string>;
  pendingLabel: string;
  undoLabel: string;
  dismissLabel: string;
  placement?: "fixed" | "inline";
}) {
  const fieldsIdentity = JSON.stringify(fields);
  const [dismissedTarget, setDismissedTarget] = useState<{
    fieldsIdentity: string;
    message: string;
  } | null>(null);
  const dismissed =
    dismissedTarget?.fieldsIdentity === fieldsIdentity && dismissedTarget.message === message;
  if (dismissed) return null;

  return (
    <ToastShell
      autoDismissMs={null}
      placement={placement}
      className={
        placement === "inline"
          ? "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-2"
          : "flex items-center gap-2 py-3 ps-4 pe-1"
      }
    >
      <span className="min-w-0 text-sm font-medium">{message}</span>
      <div className="flex shrink-0 items-center">
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
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={() => setDismissedTarget({ fieldsIdentity, message })}
          className={buttonClass({
            variant: "ghost",
            size: "icon",
            className: "focus-visible:focus-ring-inset",
          })}
        >
          <DiveDayIcon name="close" />
        </button>
      </div>
    </ToastShell>
  );
}
