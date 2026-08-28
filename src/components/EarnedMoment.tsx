/**
 * The coral-accented moment a surface earns when the user finishes something —
 * booking confirmed, waiver signed, everyone aboard, you're all set
 * (design/principles.md #3). `--accent` appears nowhere else on a page, so joy
 * stays rationed and keeps its meaning, and `rise-in` gives it a ≤400 ms
 * entrance that the reduced-motion kill-switch still neutralises.
 *
 * **Two shapes, one vocabulary** (issue 761). This module owns the look and the
 * rationing rule; a surface picks the shape its moment is, and never redraws
 * either at the call site:
 *
 * - {@link EarnedMoment} — the whole-page moment on a diver's token page. A
 *   heading, a body, and rising coral bubbles.
 * - {@link EarnedMomentLine} — one line inside a working staff surface, where
 *   a coral panel with bubbles in the middle of a queue would be far too much.
 *
 * The compact shape is not new; three surfaces had already built it by hand,
 * each correctly citing principle 3 and each arriving at a different object:
 * Today's all-clear line, the departure board's everyone-aboard line and the
 * gear register's last-return line disagreed on radius, padding, text size,
 * whether they announced themselves with `role="status"`, and whether they
 * carried an emoji. That is the same drift `SectionCard` and `EmptyState` were
 * built to stop.
 *
 * **The component supplies no glyph.** The departure board's `🎉` lived in
 * markup while Today's `🤙` lives inside its sentence in both locale bundles —
 * two mechanisms for one idea, and the markup one is invisible to a translator.
 * The panel is the celebration; if a moment's words carry a mark, it belongs in
 * the words, where somebody translating them can see it. (This is not the
 * `tone.ts` question: those emoji are *status* marks carrying pass/fail/caution
 * to a colourblind scan, which is a different job with its own long argument.)
 */
/**
 * The accent surface itself, for the rare moment that is a panel with its own
 * heading rather than a line or a whole-page block — the close-out's record of
 * a day that closed with nothing outstanding is the only one.
 *
 * Exported as a class string rather than forced into one of the two components
 * because that panel has a heading, a `closedBy` line and an
 * `aria-labelledby` of its own; bending a component to accept all three would
 * buy nothing the constant does not. What matters is that the *vocabulary*
 * lives here, so a fourth surface cannot invent a fourth coral.
 */
export const EARNED_MOMENT_SURFACE = "rise-in rounded-2xl border border-accent/40 bg-accent/10";

/**
 * One earned line inside a working surface. `role="status"` because these all
 * appear in response to something the user just did — the last diver boarding,
 * the last set of fins coming back — on a page that does not reload.
 *
 * `animate={false}` drops the `rise-in` entrance for the one case that
 * entrance is wrong: a page that *loads* already carrying the moment. A boat
 * cleared an hour ago is a fact on arrival, not a thing that just happened,
 * and re-playing the celebration on every visit is what makes it stop meaning
 * anything (ADR 20260827-clearwater-surface-language, decision 11 — every
 * moment is earned and transient). The caller owns that judgement because only
 * it can tell a first paint from a transition; see
 * `check-in/_components/CounterClearedLine.tsx` for the guard.
 */
export function EarnedMomentLine({
  children,
  animate = true,
  className = "",
}: {
  children: React.ReactNode;
  /** Play the `rise-in` entrance. Off for a moment that was already true on arrival. */
  animate?: boolean;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`${
        animate ? "rise-in " : ""
      }rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-semibold ${className}`.trim()}
    >
      {children}
    </p>
  );
}

export function EarnedMoment({
  eyebrow,
  title,
  children,
  className = "",
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /**
   * Heading level for `title`. Defaults to h2, correct when the page has its
   * own h1 elsewhere (as `/ready` and `/recap` do) — pass "h1" when this
   * moment is the page's only heading, or the screen-reader outline starts at
   * level two with no level-one heading at all.
   */
  as?: "h1" | "h2";
}) {
  return (
    <section
      className={`relative overflow-hidden rise-in rounded-2xl border border-accent/40 bg-accent/10 p-6 sm:p-7 ${className}`.trim()}
    >
      {eyebrow ? (
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">{eyebrow}</p>
      ) : null}
      <Heading className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {title}
      </Heading>
      {children ? <div className="mt-3 text-muted">{children}</div> : null}
      {/* Waiver Signature Coral Bubbles */}
      <div className="bubble-container" aria-hidden="true">
        <span
          className="coral-bubble animate-bubble"
          style={{
            left: "10%",
            width: "12px",
            height: "12px",
            animationDelay: "0s",
            animationDuration: "3s",
          }}
        />
        <span
          className="coral-bubble animate-bubble"
          style={{
            left: "25%",
            width: "8px",
            height: "8px",
            animationDelay: "0.5s",
            animationDuration: "2.5s",
          }}
        />
        <span
          className="coral-bubble animate-bubble"
          style={{
            left: "45%",
            width: "16px",
            height: "16px",
            animationDelay: "1.2s",
            animationDuration: "3.5s",
          }}
        />
        <span
          className="coral-bubble animate-bubble"
          style={{
            left: "60%",
            width: "10px",
            height: "10px",
            animationDelay: "0.2s",
            animationDuration: "2.8s",
          }}
        />
        <span
          className="coral-bubble animate-bubble"
          style={{
            left: "75%",
            width: "14px",
            height: "14px",
            animationDelay: "1.8s",
            animationDuration: "3.2s",
          }}
        />
        <span
          className="coral-bubble animate-bubble"
          style={{
            left: "90%",
            width: "7px",
            height: "7px",
            animationDelay: "0.8s",
            animationDuration: "2.2s",
          }}
        />
      </div>
    </section>
  );
}
