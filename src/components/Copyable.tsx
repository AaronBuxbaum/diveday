"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

type CopyStatus = "idle" | "copied" | "failed";

/**
 * The single clipboard write every copy-to-clipboard control in the app goes
 * through — `Copyable` itself, and the handful of sites whose control isn't
 * `Copyable`-shaped (a share-then-fallback button, a link that copies as a
 * courtesy on its way to an external site) but still must not hand-roll
 * `navigator.clipboard.writeText` directly. Resolves `true` on success,
 * `false` on a denied or unsupported clipboard — never throws.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A generalized copy-to-clipboard control (originally `CopyableUrl` in
 * `settings/calendar/CalendarFeedPanel.tsx`). Two layouts share the same
 * clipboard logic and status handling:
 *
 * - `"panel"` — a labelled sunken box with the value printed underneath (the
 *   webcal/https feed links).
 * - `"inline"` — just the button, for a value already shown elsewhere on the
 *   row (a promo code next to its badge).
 *
 * On a denied or unsupported clipboard, the button reports `failedLabel`
 * instead of silently doing nothing — the value is always visible on screen
 * either way, so a failed copy must read as "select it yourself", not as a
 * failed mint or a no-op nobody can explain.
 */
export function Copyable({
  value,
  label,
  hint,
  copyLabel,
  copiedLabel,
  failedLabel,
  layout = "panel",
  className,
}: {
  value: string;
  label?: string;
  hint?: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
  layout?: "panel" | "inline";
  className?: string;
}) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function copy() {
    const ok = await copyToClipboard(value);
    setStatus(ok ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 4000);
  }

  const buttonText =
    status === "copied" ? copiedLabel : status === "failed" ? failedLabel : copyLabel;

  const button = (
    <button type="button" onClick={copy} className={buttonClass({ variant: "ghost", size: "sm" })}>
      <span aria-live="polite" className={status === "failed" ? "text-danger" : undefined}>
        {buttonText}
      </span>
    </button>
  );

  if (layout === "inline") return <span className={className}>{button}</span>;

  return (
    <div className={`rounded-xl bg-surface-sunken p-3 ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
        {button}
      </div>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      <p className="mt-2 font-mono text-xs break-all text-foreground">{value}</p>
    </div>
  );
}
