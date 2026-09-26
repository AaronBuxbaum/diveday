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
 * `flush` puts the button's word on the edge its box stands on rather than
 * 12px inside it (`buttonClass`'s `flush`). The panel's button always ends its
 * header row, so the panel takes it by default; an inline button is flush only
 * where its caller starts a line with it — the embed snippet's Copy under its
 * box, the party panel's reminder under the seat's name. Mid-row, among other
 * words (a promo code's, a waiver link's), it keeps its padding, which is what
 * keeps its hover fill off its neighbours.
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
  flush = layout === "panel",
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
  /** The button starts or ends its line: its word sits on that edge. Default: the panel's. */
  flush?: boolean;
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

  // In the panel, the trigger gives back what its 44px target adds above the
  // label's 20px line — `-mt-3`, with the row's items at its top so the label
  // and "Copy link" share one centre — and `flush`'s `-mx-2 px-2` at the
  // sides, so the caption sets the panel's top inset and its start edge. With
  // its whole box in the header row, lined up by baseline, the target made the
  // band above the caption 27px deep against 13px under the URL, and ended
  // "Copy link" 23px inside the edge the caption starts 11px inside.
  //
  // **Only above.** Given back below as well (`-my-3`), the box ran 12px under
  // a row the URL starts 8px beneath: its hover wash covered the top of the
  // URL's first line, and at 390, where that line runs under the button, its
  // inset ring's bottom edge lay on the URL's ink (K-108 review). Below the
  // label the row keeps the box's lower half, so the URL starts 8px clear of
  // it. The target stays 44px, and its hover wash and ring take that whole box.
  // Inline, it sits in its caller's row as is.
  const panel = layout === "panel";
  const button = (
    <button
      type="button"
      onClick={copy}
      className={buttonClass({
        variant: "ghost",
        size: "sm",
        flush,
        // `-mt-3` (K-108) is the panel's alone: see above. The panel's 12px
        // inset leaves a flush fill 4px from the sunken box's edge, and the
        // outdented box reaches its top, so the ring is drawn inside rather
        // than a pixel outside the box.
        className: panel ? "-mt-3 focus-visible:focus-ring-inset" : undefined,
      })}
    >
      <span aria-live="polite" className={status === "failed" ? "text-danger" : undefined}>
        {buttonText}
      </span>
    </button>
  );

  if (!panel) return <span className={className}>{button}</span>;

  return (
    <div className={`rounded-inset bg-surface-sunken p-3 ${className ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
        {button}
      </div>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      {/* `wrap-anywhere`, not `break-all`: a URL breaks after its hyphens
          first ("bookable-" / "light"), and only a token too long for the
          line is broken mid-word. `break-all` split the slug at any letter. */}
      <p className="mt-2 font-mono text-xs wrap-anywhere text-foreground">{value}</p>
    </div>
  );
}
