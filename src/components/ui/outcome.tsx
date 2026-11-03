import type { Key, ReactNode } from "react";
import { Toast } from "@/components/Toast";
import { StatusMarkColumn } from "@/components/ui/StatusMark";
import type { NoticeTone } from "@/components/ui/tone";
import { type ToneName, toneMark } from "@/components/ui/tone";

/**
 * The tones the banner draws: `NoticeTone` (the vocabulary a notice map
 * declares, `src/lib/staff-notices.ts`) kept to the names the shared tone
 * vocabulary has. A tone added to one and not the other is a compile error
 * here, not a banner with no colour.
 */
type NoticeBannerTone = Extract<ToneName, NoticeTone>;

export function ShopNotice({
  children,
  tone = "success",
  role = "status",
  className = "",
  occurrenceKey,
  persistent = false,
}: {
  children: ReactNode;
  tone?: NoticeBannerTone;
  role?: "status" | "alert";
  className?: string;
  /** Action/result identity so consecutive identical confirmations replay. */
  occurrenceKey?: Key;
  /** Keep detailed result content on the page instead of auto-dismissing it. */
  persistent?: boolean;
}) {
  if (tone === "success" && !persistent)
    return <Toast message={children} pausable occurrenceKey={occurrenceKey} />;
  // `-strong` on the success tint: the raw hue on its own 10% fill is 4.39:1 in
  // the light palette, under AA (docs/design/forms-and-controls.md). `danger`
  // needs no nudge and `warning` already reads as body text on its tint.
  const toneClass =
    tone === "danger"
      ? "border-danger/20 bg-danger-tint text-danger"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-foreground"
        : tone === "neutral"
          ? "border-border bg-surface-sunken text-foreground"
          : "border-success/20 bg-success-tint text-success-strong";
  const mark = toneMark(tone);

  return (
    <div
      role={role}
      // `rise-in`: the app's most-seen success signal used to be the one
      // feedback vehicle with no entrance — a tap acknowledged itself, the
      // page reloaded, and the outcome was simply there. The same arrival the
      // toast and the earned moment make; `prefers-reduced-motion` stills it.
      //
      // **A row aligned on the first baseline** (K-15). The mark used to be a
      // bare svg in front of the words, which preflight makes a block, so it
      // stood alone on a line above them. Not `items-start`: a notice's first
      // line is not always at its top — the trip banner's words sit centred
      // beside a 44px Undo, the duplicate-diver warning opens on a 16px
      // heading — so the mark's column carries one line of the notice's own
      // text (`StatusMarkColumn`) and the row lines that line's baseline up
      // with the words' first one, wherever it is. `ShopPageHeader.test.tsx`.
      className={`rise-in flex items-baseline gap-2 rounded-inset border px-4 py-3 text-sm font-medium ${toneClass} ${className}`}
    >
      {mark ? <StatusMarkColumn variant={mark} /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
