import type { CSSProperties, ReactNode } from "react";
import { PRINT_SHEET_BOX_MM, type PrintSheetPaper } from "@/lib/print-sheets";

/**
 * **One sheet of the shop's paper** — ADR 20260908-one-hand, decision 6,
 * lever X.
 *
 * The band, the body and the fold line, at a fixed size in millimetres.
 *
 * Two things it owns:
 *
 * - **The box.** `PRINT_SHEET_BOX_MM` is the paper less the `@page` margin the
 *   route declares, so what is drawn here is the page that comes out of the
 *   printer. It is a floor — a sheet whose content outgrows its paper takes a
 *   second page rather than cutting a word off.
 * - **The band's colour, as a value rather than a token.** `@media print`
 *   redefines `--primary` to repaint the app monochrome, so a band drawn from
 *   the token would print grey. The caller resolves the colour — the shop's
 *   derived brand — and it arrives here as a custom property on the element.
 *
 * The fold line is not decoration: paper outlives the morning it was printed,
 * and the date plus the storefront's address is how a diver holding it can
 * tell how old it is.
 */
export type SheetTone = {
  /** The band's fill. */
  band: string;
  /** The ink on it. */
  bandInk: string;
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
  /** The storefront's address. */
  foldRight: ReactNode;
  children: ReactNode;
}) {
  const box = PRINT_SHEET_BOX_MM[paper];
  return (
    <section
      className="paper-sheet"
      style={
        {
          width: `${box.width}mm`,
          // A floor: a sheet that outgrows its paper takes a second page rather
          // than losing a word.
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
