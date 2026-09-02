"use client";

import { useEffect, useState } from "react";
import { hapticsAvailable, hapticsEnabled, setHapticsEnabled } from "./haptics";

/**
 * **The vibration switch, on the device that does the vibrating.**
 *
 * Per device rather than per person, and beside the boat-mode contrast control
 * for the same reason: both are properties of the phone in a wet pocket, not
 * of whoever picked it up. A shop's spare deck phone is shared.
 *
 * It exists because the roll call's completion pattern is
 * `[100, 50, 100, 50, 200]` — half a second of buzzing — and there was no way
 * to turn it off. Vibration is a real problem for some people with tremor or
 * vestibular conditions, and `prefers-reduced-motion` does not reach it: that
 * media query is about animation, so the app's motion kill-switch in
 * `globals.css` cannot do this job (issue #817).
 *
 * **Absent where the capability is.** No iPhone implements `navigator.vibrate`
 * at any version, so on one this renders nothing rather than offering a switch
 * for a channel the device does not have. A sentence explaining that would
 * earn a crew member nothing they could act on; the platform split is written
 * down in `./haptics` and in docs/design/principles.md §2, where the next
 * person to build on the channel will look.
 */
export function HapticsToggle({
  copy,
  className = "",
}: {
  copy: { label: string };
  className?: string;
}) {
  const [enabled, setEnabled] = useState(true);
  // Both the stored preference and the capability are client facts, so nothing
  // renders until they are known — an unchecked flash would misreport a device
  // that had turned it off, and an iPhone would show the control for a frame.
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(hapticsAvailable());
    setEnabled(hapticsEnabled());
    setReady(true);
  }, []);

  if (!ready || !available) return null;

  return (
    <label
      className={`group inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-sunken p-3 text-sm font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground print:hidden ${className}`.trim()}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => {
          setEnabled(event.target.checked);
          setHapticsEnabled(event.target.checked);
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-border transition-colors after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-surface after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
      />
      {copy.label}
    </label>
  );
}
