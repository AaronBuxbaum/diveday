"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * `autoCopy` is for the one shape where the copy *is* the errand: a control
 * labelled "Copy link" that has to mint the value on the server first, so the
 * clipboard write cannot happen inside the tap that asked for it (the diver
 * record's waiver row). It attempts the write once, when the value arrives, and
 * the button is the fallback rather than the mechanism — Safari and Firefox
 * require the write to sit inside a user gesture, so an attempt after a server
 * round trip is allowed to fail there and reports `failedLabel` when it does.
 * Never set it on a value the person did not ask to copy: it overwrites
 * whatever their clipboard was holding.
 */
export function Copyable({
  value,
  label,
  hint,
  copyLabel,
  copiedLabel,
  failedLabel,
  layout = "panel",
  autoCopy = false,
  className,
}: {
  value: string;
  label?: string;
  hint?: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
  layout?: "panel" | "inline";
  /** Attempt the write as soon as `value` arrives — only when the copy is the errand. */
  autoCopy?: boolean;
  className?: string;
}) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The one place a write's outcome becomes what the button says, so the two
  // paths that can write (the tap and the `autoCopy` effect) cannot settle back
  // to idle on different schedules.
  const report = useCallback((ok: boolean) => {
    setStatus(ok ? "copied" : "failed");
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 4000);
  }, []);

  async function copy() {
    report(await copyToClipboard(value));
  }

  // Deliberately keyed on the value, not on mount: each "Copy link" tap mints a
  // fresh link, and the freshly rendered one is what belongs on the clipboard.
  // Nothing here is optimistic — the write is reported only once it resolves.
  useEffect(() => {
    if (!autoCopy) return;
    let alive = true;
    void copyToClipboard(value).then((ok) => {
      if (alive) report(ok);
    });
    return () => {
      alive = false;
    };
  }, [autoCopy, value, report]);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

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
    <div className={`rounded-inset bg-surface-sunken p-3 ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
        {button}
      </div>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      <p className="mt-2 font-mono text-xs break-all text-foreground">{value}</p>
    </div>
  );
}
