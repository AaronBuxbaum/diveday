import { FIGURE_DIAL_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The count that fills — Reef's second moment (ADR 20260901-diveday-reimagined,
 * slice 13h), on the one surface that counts heads.
 *
 * The roll call's head count is drawn as a round figure whose water rises a
 * little with every diver counted **aboard**, and stands at the brim only when
 * everyone who went out is back. The figure is exact and tabular the whole
 * way; **the fill never says anything the number and the words do not.** It is
 * `aria-hidden` decoration behind a `role="progressbar"` that carries the real
 * values and the sentence ("7 of 8 divers aboard"), the same words stand
 * beside the figure at reading size for sighted eyes, and the panel's heading
 * says "Roll call complete" in words — colour and water level never carry a
 * state alone, which is the safety floor every roll-call surface keeps.
 *
 * **Aboard, never "recorded"** (dive-domain review 20260902). The first cut
 * raised the water on *has a result*, which a diver marked **not back aboard**
 * also has — so eight out, seven back and one missing drew a full glass at the
 * exact moment the page holds its loudest fact. The water counts `boarded`,
 * and after a dive the glass is *who went out* rather than who bought a seat
 * (glossary, "Roll-call checkpoint"): a diver who never left the dock does not
 * keep the figure short all day. A missing diver holds the water under the
 * brim by construction.
 *
 * Two rules from the ADR's tables, held here rather than remembered: the water
 * is `shallows` — the token Reef minted for exactly this, "water fills that
 * carry no fact" — and never coral (no coral on a manifest or a roll call —
 * the canvas's coral bubble at the brim was drawn for a surface that allows
 * one, and this is not it), and there is no drawing in it (no illustration on
 * a roll call either — a water level is a fill, not a creature).
 *
 * The rise is a `scaleY` transition, never a `height`: principle 5's
 * transform-only rule, the same reason `ProgressBar` scales its sheets. The
 * reduced-motion kill-switch in `globals.css` zeroes the transition, so that
 * reader sees the level step. The numbers are passed through unclamped — on a
 * safety surface a bad count should *look* bad rather than fill a glass — and
 * only the fill's fraction is bounded, since the water cannot leave the glass.
 */
export function HeadCount({
  aboard,
  out,
  blocked = 0,
  blockedAboard = 0,
  t,
  className = "",
}: {
  /** Divers with an *aboard* result at this checkpoint. */
  aboard: number;
  /** The population the count is about: everyone at the dock, or everyone who went out. */
  out: number;
  /**
   * Blocked divers still to decide about (`summary.blockedUndecided`), said
   * beside the count — the dock only; the caller passes 0 after a dive, where
   * blocked gates nothing.
   */
  blocked?: number;
  /** Blocked divers the crew marked aboard anyway (`summary.blockedAboard`); the dock only. */
  blockedAboard?: number;
  t: StaffTranslator;
  className?: string;
}) {
  // Bounded for the pixels only: an empty glass stands at zero rather than
  // dividing by it, and the water cannot rise past the brim.
  const fraction = out > 0 ? Math.min(1, Math.max(0, aboard / out)) : 0;
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <div
        role="progressbar"
        aria-label={t("manifest.progressAriaLabel")}
        aria-valuemin={0}
        aria-valuemax={out}
        aria-valuenow={aboard}
        aria-valuetext={t("manifest.aboardOfTotal", { aboard, total: out })}
        className="relative size-20 shrink-0 overflow-hidden rounded-full border border-border bg-surface-sunken"
      >
        <div
          aria-hidden="true"
          data-head-count-water
          className="absolute inset-0 origin-bottom bg-shallows transition-transform duration-300 ease-out-soft"
          style={{ transform: `scaleY(${fraction})` }}
        />
        {/* The figure sits over the water, not in it: the number is the fact
            and the water is its shape (principle 9). */}
        <span className={`absolute inset-0 flex items-center justify-center ${FIGURE_DIAL_CLASS}`}>
          {aboard}
        </span>
      </div>
      {/* The rest of the sentence, at reading size and outside the glass: a
          count is critical text on a roll call (principles.md §1, 16px), and a
          caption that straddled the water line inside an 80px circle was
          neither. `aria-hidden`: the progressbar's own text already says it. */}
      {/* **The headline never reassures over a blocked row** (UX audit
          2026-10-07, item 16). "8 of 8 divers aboard" stood at the top of a
          roster with three rows reading Blocked, and the count of them was a
          sentence in the half of the panel that scrolls away. It is the
          count's own next line now, in the danger the rows wear, pinned with
          the figure it qualifies. Two facts, never one sum: a blocked diver
          still to decide about, and — louder — one the crew marked aboard
          anyway. A blocked diver left ashore or released by the desk is
          settled, and outside the total above, so neither counts them.
          The words are not `aria-hidden`: the progressbar's text says the
          count, and these say what the count does not. */}
      <div className="text-base font-semibold tabular-nums">
        <p aria-hidden="true">{t("manifest.ofTotalAboard", { total: out })}</p>
        {blockedAboard > 0 ? (
          <p className="font-bold text-danger">
            {t("manifest.headCountBlockedAboard", { count: blockedAboard })}
          </p>
        ) : null}
        {blocked > 0 ? (
          <p className="font-bold text-danger">
            {t("manifest.headCountBlocked", { count: blocked })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
