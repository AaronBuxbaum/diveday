import type { CSSProperties, ReactNode } from "react";
import { PRINT_SHEET_BOX_MM, type PrintSheetPaper } from "@/lib/print-sheets";

/**
 * **One sheet of the shop's paper** — ADR 20260908-one-hand, decision 6,
 * lever X.
 *
 * The band, the body and the fold line, at a fixed size in millimetres. Every
 * sheet in the register is this component with different contents, which is
 * what keeps five documents one design rather than five.
 *
 * Two things it owns:
 *
 * - **The box.** `PRINT_SHEET_BOX_MM` is the paper less the `@page` margin the
 *   route declares, so what is drawn here is the page that comes out of the
 *   printer — as a floor rather than a ceiling. A sheet whose content outgrows
 *   its paper takes a second page; it never clips, because a card that cut a
 *   shop's own briefing off would be read on a boat as the whole briefing.
 * - **The band's colour, as a value rather than a token.** `@media print`
 *   redefines `--primary` to repaint the app monochrome, so a band drawn from
 *   the token would print grey. The caller resolves the colour — the shop's
 *   derived brand, or the boat's own action colour for anything that rides a
 *   boat — and it arrives here as a custom property on the element.
 *
 * The fold line is not decoration: paper outlives the morning it was printed,
 * and the date plus the storefront's address is how a diver holding it, or a
 * skipper reading a card taped to the console, can tell how old it is.
 */
export type SheetTone = {
  /** The band's fill. */
  band: string;
  /** The ink on it. */
  bandInk: string;
  /** The night side of the boat card: a dark ground a red torch reads. */
  night?: boolean;
};

export function PaperSheet({
  paper,
  tone,
  band,
  foldLeft,
  foldRight,
  children,
}: {
  paper: PrintSheetPaper;
  tone: SheetTone;
  /** What sits in the coloured band across the head of the sheet. */
  band: ReactNode;
  /** The print date, always. */
  foldLeft: ReactNode;
  /** The storefront's address, or which side of a two-sided card this is. */
  foldRight: ReactNode;
  children: ReactNode;
}) {
  const box = PRINT_SHEET_BOX_MM[paper];
  return (
    <section
      className={`paper-sheet${tone.night ? " paper-sheet-night" : ""}`}
      style={
        {
          width: `${box.width}mm`,
          // A floor, not a ceiling. A shop's briefing is prose of whatever
          // length the shop wrote, and a card that clipped it would be read on
          // a boat as the whole briefing — so a sheet that outgrows its paper
          // takes a second page rather than losing a word.
          minHeight: `${box.height}mm`,
          "--sheet-band": tone.band,
          "--sheet-band-ink": tone.bandInk,
        } as CSSProperties
      }
    >
      <div className="paper-sheet-band">{band}</div>
      <div className="paper-sheet-body">{children}</div>
      <div className="paper-sheet-fold">
        <span>{foldLeft}</span>
        <span>{foldRight}</span>
      </div>
    </section>
  );
}

/**
 * The shop's mark in the band: its initials, reversed out of the band's ink.
 *
 * Initials rather than a logo, for the reason `src/lib/brand.ts` states about
 * badges — DiveDay never draws a mark it has no right to show, and a shop that
 * has uploaded nothing still gets a sheet that looks like itself.
 */
export function SheetMark({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      className={`paper-sheet-mark ${size === "sm" ? "size-6 text-[0.5rem]" : "size-8 text-[0.625rem]"}`}
    >
      {initials}
    </span>
  );
}

/**
 * A value the shop has recorded, or a rule to fill in by hand.
 *
 * **Never a default.** A number DiveDay invented on the boat card is worse than
 * a blank, because the crew dialling it has spent the minute finding out
 * (`src/lib/emergency-reference.ts` states the same rule for the screen).
 */
export function SheetValue({ value }: { value: string | null }) {
  if (value) return <>{value}</>;
  return <span className="paper-sheet-blank" />;
}
