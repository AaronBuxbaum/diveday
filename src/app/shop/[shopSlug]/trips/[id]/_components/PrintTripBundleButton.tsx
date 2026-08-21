// i18n-exempt-file: type-only action signature; the visible label arrives as a translated prop.
"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

type RecordPrintAction = (formData: FormData) => void | Promise<void>;

/**
 * Opens the print bundle from the Overview tab without losing the originating
 * click to a popup blocker. The form action records the click server-side,
 * while the synchronous `window.open` lets the new tab show its print dialog.
 */
export function PrintTripBundleButton({
  href,
  label,
  popupBlockedLabel,
  recordAction,
}: {
  href: string;
  label: string;
  popupBlockedLabel: string;
  recordAction: RecordPrintAction;
}) {
  const [popupBlocked, setPopupBlocked] = useState(false);
  return (
    <form
      action={recordAction}
      className="print:hidden"
      onSubmit={() => {
        const popup = window.open(href, "_blank", "noopener,noreferrer");
        setPopupBlocked(popup === null);
      }}
    >
      {/* `ghost sm`, like its neighbours in the header's action cluster — the
          rarest of the three doors was the only one wearing a bordered box,
          which put the heaviest chrome on the least-used action (principle 8).
          The 44px touch floor comes from the base either way. */}
      <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
        {label}
      </button>
      {popupBlocked ? (
        <p className="mt-2 max-w-xs text-sm text-danger" role="alert">
          {popupBlockedLabel}
        </p>
      ) : null}
    </form>
  );
}
