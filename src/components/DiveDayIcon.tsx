// i18n-exempt-file: pure SVG artwork — every node is aria-hidden path data,
// no words; a control that needs a name gets it from its own label.
import type { ReactNode } from "react";

export type DisclosureCaretDirection = "right" | "down";
export type WaiverActionIconName = "email" | "text" | "link" | "paper";
export type WaiverDeliveryMarkName = "sent" | "copied" | "failed" | "unavailable";
export type DiveDaySharedIconName =
  | "caret"
  | "info"
  | "empty"
  | "globe"
  | "check"
  | "pending"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down"
  | "chevron-left"
  | "chevron-right"
  | "door-chevron"
  | "more"
  | "close"
  | "plus"
  | "warning"
  | "boat"
  | "badge"
  | `waiver-action-${WaiverActionIconName}`
  | `waiver-mark-${WaiverDeliveryMarkName}`;

const SHARED_ICON_PATHS: Record<Exclude<DiveDaySharedIconName, "caret">, ReactNode> = {
  info: (
    <path
      fill="currentColor"
      stroke="none"
      d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm0 5.1a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3ZM13.8 18H10.2a1.05 1.05 0 0 1 0-2.1h.75v-3.6h-.6a1.05 1.05 0 0 1 0-2.1h2.7v5.7h.75a1.05 1.05 0 0 1 0 2.1Z"
    />
  ),
  // Three bubbles that fill the box (ink y 1.8–22.25, x 3.5–20.5, on its
  // centre) so a caller sizes the box by the ink it wants. They reached only
  // y 4.6–18.8, which left 8px of blank box above them in `EmptyState` and
  // made its panel bottom-heavy (pixel-craft K-70). Their stroke is
  // `EMPTY_STROKE`, scaled with them.
  empty: (
    <>
      <circle cx="12.3" cy="16.8" r="4.35" />
      <circle cx="7.2" cy="5.5" r="2.6" />
      <circle cx="17.65" cy="8.1" r="1.75" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  pending: <circle cx="12" cy="12" r="7" strokeDasharray="2.5 2.5" />,
  // A caution triangle, drawn on the same 24px grid at the same weight and
  // caps as its siblings. It exists because the shared `Badge` mark is an
  // emoji, and a status line that is not wearing a pill needs a mark from
  // this family instead (ADR 20260827-clearwater-surface-language: drawn SVG,
  // never emoji, on anything new).
  warning: (
    <>
      <path d="M12 3.4 21.6 20H2.4L12 3.4Z" />
      <path d="M12 10v3.6" />
      <path d="M12 16.8h.01" />
    </>
  ),
  boat: (
    <>
      <path d="M3 14.5h18l-2.5 4H5.5L3 14.5Z" />
      <path d="M6 14.5 8 6h8l2 8.5" />
      <path d="M12 6V3" />
      <path d="M12 3 18 7" />
    </>
  ),
  // A shield with a check: the one mark on each pill of a shop's badge wall,
  // DiveDay's own drawing rather than an agency's (`BadgeWall`). Drawn at
  // 1.5× the 16-unit square it used to have, so at its 2.4 stroke it renders
  // exactly as it did; its ink spans x 4.5–19.5, on the square's centre.
  badge: (
    <>
      <path d="M12 2.25 19.5 5.25v6c0 4.8-3.15 8.4-7.5 10.2-4.35-1.8-7.5-5.4-7.5-10.2v-6z" />
      <path d="m8.7 12 2.4 2.4L15.6 9.75" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M20 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  "arrow-up": (
    <>
      <path d="M12 20V5" />
      <path d="m6 11 6-6 6 6" />
    </>
  ),
  "arrow-down": (
    <>
      <path d="M12 4v15" />
      <path d="m6 13 6 6 6-6" />
    </>
  ),
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  // `chevron-right`'s stroke, drawn from `ICON_VIEWBOX`'s ink-cropped box.
  "door-chevron": <path d="m9 6 6 6-6 6" />,
  // Drawn at `size-4` on a row's menu trigger: a 2-unit dot is 2.7px there,
  // and 3 units between dots keep 2px of paper, so it reads as three dots
  // rather than three specks or a dash (pixel-craft K-89).
  more: (
    <>
      <circle cx="5" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  // A remove control's cross, in the family's weight: a typed "×" renders at
  // the font's size, 8px of ink in a 48px icon button (pixel-craft K-545).
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  // An add control's cross, the close glyph turned square to the box.
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  "waiver-action-email": (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="m21 7-8.47 5.38a1 1 0 0 1-1.06 0L3 7" />
    </>
  ),
  "waiver-action-text": (
    <>
      <path d="M20 4H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2v4l4.5-4H20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <path d="M7.5 9.5h9" />
      <path d="M7.5 13h5.5" />
    </>
  ),
  "waiver-action-link": (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  "waiver-action-paper": (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="m8.5 15 1.75 1.75L14 13" />
    </>
  ),
  "waiver-mark-sent": <path d="m5 12.5 4.5 4.5L19 7" />,
  "waiver-mark-copied": (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a1 1 0 0 1 1-1h9" />
    </>
  ),
  "waiver-mark-failed": (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  "waiver-mark-unavailable": <path d="M5 12h14" />,
};

/**
 * The bubbles' stroke: 1.5 units when they were drawn at two thirds of this
 * size, scaled with them, so they render at the weight they always had.
 */
const EMPTY_STROKE = 2.2;

const CARET_PATHS: Record<DisclosureCaretDirection, string> = {
  right: "m9 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
};

/**
 * **Where a glyph's ink starts and ends across its box**, for the glyphs a
 * caller may draw `trim`med: the path's own geometry, x from and x to, before
 * the stroke (which `trimmedViewBox` adds, so a heavier stroke still fits).
 *
 * A glyph leading a row lines up by its ink, the way the words beside it do
 * (docs/design/pixel-craft.md, classes 2 and 3), and one ending a row ends on
 * its ink. In the shared 24-unit square the dive-site catalog door's pin
 * started 3px inside the column its row's words start on (pixel-craft K-519),
 * the back-link's chevron 3–4px right of its title's column (K-114), a
 * ledger door's chevron 5px inside its row's end (K-118), and the badge
 * wall's shield 2px inside its pill's padding, in a square of its own (K-561).
 *
 * **This is the one way to draw a glyph on its ink.** Not a second name for a
 * cropped copy of a path, and not a viewBox written by hand at the call site:
 * `trim` is opt-in per call, so a glyph's square users keep the square, and
 * the crop follows the stroke the caller draws. An entry here is measured
 * from the path above it, never guessed: a wrong one crops the ink it was
 * meant to align. The destination glyphs' entries (the pin) sit beside their
 * paths in `StaffDestinationIcon.tsx`.
 */
const TRIM_X = {
  // Both chevrons run between x 9 and x 15, point and arms.
  "chevron-left": [9, 15],
  "chevron-right": [9, 15],
  // The shield's two sides, x 4.5 and x 19.5; the check sits inside them.
  badge: [4.5, 19.5],
} as const satisfies Partial<Record<DiveDaySharedIconName, readonly [number, number]>>;

/** A glyph whose horizontal ink is recorded, so `trim` can crop its box to it. */
export type TrimmableIconName = keyof typeof TRIM_X;

/** The box cropped to a glyph's ink across, stroke included, at the full 24-unit height. */
export function trimmedViewBox([from, to]: readonly [number, number], stroke: number) {
  const round = (value: number) => Number(value.toFixed(3));
  return `${round(from - stroke / 2)} 0 ${round(to - from + stroke)} 24`;
}

/**
 * **A mark whose box is cropped to its ink across** — the one exception to the
 * 24-unit square, spelled here so it cannot drift into a component.
 *
 * `door-chevron` is `chevron-right` for the end of a ledger row, drawn at a
 * height and an automatic width (`h-4 w-auto`). The square left about 5px of
 * empty box right of the stroke at 16px, so every door's arrow stopped 5px
 * inside the edge the rest of its row ends on (pixel-craft class 2). The box
 * runs from the stroke's left to its right edge (x 8.1–15.9, round caps and
 * join at width 1.8) with 0.35 units either side, and keeps the full 24-unit
 * height, so the glyph is drawn at exactly the size it was. A new name rather
 * than a cropped `chevron-right`, because that one's users size it square,
 * where a narrow viewBox would be scaled up to fill the square.
 */
const ICON_VIEWBOX: Partial<Record<DiveDaySharedIconName, string>> = {
  "door-chevron": "7.75 0 8.5 24",
};

/**
 * The one SVG root of the drawn family: a 24-unit box, round caps and joins,
 * `currentColor` ink, always `aria-hidden`. `DiveDayIcon` and
 * `StaffDestinationIcon` both draw through it, so neither can drift into its
 * own stroke grammar.
 */
export function DiveDayGlyph({
  viewBox = "0 0 24 24",
  stroke,
  inked = true,
  className,
  children,
}: {
  viewBox?: string;
  stroke: number;
  /** False for a filled mark (the info dot), which draws no outline. */
  inked?: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox={viewBox}
      fill="none"
      stroke={inked ? "currentColor" : "none"}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/**
 * DiveDay's small marks belong to the same 24px drawn family as the staff
 * destinations (`StaffDestinationIcon`). Keeping the SVG root here means a
 * caret, empty-state bubble, info hint, language globe, and waiver mark cannot
 * drift into their own viewBox or stroke grammar in another component. A leaf:
 * a diver page that draws a caret does not download every destination's
 * artwork.
 */
export function DiveDayIcon<N extends DiveDaySharedIconName>({
  name,
  className = "size-4",
  direction = "right",
  strokeWidth = 1.8,
  trim,
}: {
  name: N;
  className?: string;
  direction?: DisclosureCaretDirection;
  strokeWidth?: number;
  /**
   * Crop the box to the glyph's horizontal ink, stroke included, and keep its
   * full height, so a glyph that leads a row starts where the row's words do.
   * Size it by height, `h-5 w-auto`: the box then comes out as wide as the
   * ink, where a square class would centre the ink in the square again.
   * Accepted only on a glyph `TRIM_X` has measured.
   */
  trim?: [N] extends [TrimmableIconName] ? boolean : never;
}) {
  const isCaret = name === "caret";
  const isEmpty = name === "empty";
  const isMark = name.startsWith("waiver-mark-");
  const stroke = isMark ? 2.4 : isCaret ? 2.5 : isEmpty ? EMPTY_STROKE : strokeWidth;
  return (
    <DiveDayGlyph
      viewBox={
        trim && name in TRIM_X
          ? trimmedViewBox(TRIM_X[name as TrimmableIconName], stroke)
          : ICON_VIEWBOX[name]
      }
      stroke={stroke}
      inked={name !== "info"}
      className={className}
    >
      {isCaret ? (
        <path d={CARET_PATHS[direction]} />
      ) : (
        SHARED_ICON_PATHS[name as Exclude<DiveDaySharedIconName, "caret">]
      )}
    </DiveDayGlyph>
  );
}
