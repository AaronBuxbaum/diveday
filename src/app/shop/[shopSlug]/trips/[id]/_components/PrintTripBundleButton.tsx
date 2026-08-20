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
      <button type="submit" className={buttonClass({ variant: "secondary" })}>
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
