import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The count that fills — Reef's second moment (ADR 20260901-diveday-reimagined,
 * slice 13h), on the one surface that counts heads.
 *
 * The roll call's head count is drawn as a round figure whose water rises a
 * little with every diver counted back, and stands at the brim when everyone
 * is. The figure is exact and tabular the whole way; **the fill never says
 * anything the number and the word do not.** It is `aria-hidden` decoration
 * behind a `role="progressbar"` that carries the real values and the sentence
 * ("3 of 8 divers recorded"), and the panel's heading says "Roll call
 * complete" in words — colour and water level never carry the state alone,
 * which is the safety floor every roll-call surface keeps.
 *
 * Two rules from the ADR's tables, held here rather than remembered: the water
 * is the lagoon wash and never coral (no coral on a manifest or a roll call —
 * the canvas's coral bubble at the brim was drawn for a surface that allows
 * one, and this is not it), and there is no drawing in it (no illustration on
 * a roll call either — a water level is a fill, not a creature).
 *
 * The rise is a `scaleY` transition, never a `height`: principle 5's
 * transform-only rule, the same reason `ProgressBar` scales its sheets. The
 * reduced-motion kill-switch in `globals.css` zeroes the transition, so that
 * reader sees the level step.
 */
export function HeadCount({
  recorded,
  total,
  t,
  className = "",
}: {
  /** Divers with a result at this checkpoint. */
  recorded: number;
  /** Divers on the manifest. */
  total: number;
  t: StaffTranslator;
  className?: string;
}) {
  // Clamped: a bad count cannot overflow the figure, and an empty roster
  // stands at zero rather than dividing by it.
  const fraction = total > 0 ? Math.min(1, Math.max(0, recorded / total)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={t("manifest.progressAriaLabel")}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(recorded, total)}
      aria-valuetext={t("manifest.recordedOfTotal", { recorded, total })}
      className={`relative size-20 shrink-0 overflow-hidden rounded-full border border-border bg-surface-sunken ${className}`.trim()}
    >
      <div
        aria-hidden="true"
        data-head-count-water
        className="absolute inset-0 origin-bottom bg-primary-tint transition-transform duration-300 ease-out-soft"
        style={{ transform: `scaleY(${fraction})` }}
      />
      {/* The figures sit over the water, not in it: the number is the fact and
          the water is its shape (principle 9). */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl leading-none font-bold tabular-nums">{recorded}</span>
        <span className="mt-0.5 text-xs font-semibold text-muted tabular-nums">
          {t("manifest.ofTotal", { total })}
        </span>
      </div>
    </div>
  );
}
