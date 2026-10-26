import type { ReactNode } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";

/**
 * The glyph and the gap beside it, per type size: the chips' `text-xs`, the
 * phone list's `text-sm`. The glyph is its type's own size; the gap is 4px
 * beside 12px type and 6px beside 14px, as `FormStatus` sets its mark.
 */
const WARNING_LINE_SIZE = {
  xs: { gap: "gap-1", glyph: "size-3" },
  sm: { gap: "gap-1.5", glyph: "size-3.5" },
} as const;

/**
 * **The week's one warning line** (K-241): the glyph, then the words, in the
 * warning ink. The crew chip drew the glyph at 10px beside a 4px gap, the gap
 * chip at 12px beside 6px, and both nudged it down `mt-0.5`, which set it
 * 1–1.5px below its line's capitals. Here it sits centred in a box one line
 * of its own text tall (`h-lh`), at the top of a line that may wrap — the
 * middle of a line box is where its capitals are centred, at any type size —
 * so no nudge is needed, and each type size draws it one way.
 */
export function WarningLine({
  size,
  className = "",
  children,
}: {
  size: keyof typeof WARNING_LINE_SIZE;
  /** The line's place among its siblings (a margin), never its geometry. */
  className?: string;
  children: ReactNode;
}) {
  const { gap, glyph } = WARNING_LINE_SIZE[size];
  return (
    <span
      className={`flex items-start ${gap} font-semibold text-warning-strong ${className}`.trim()}
    >
      <span className="flex h-lh shrink-0 items-center">
        <DiveDayIcon name="warning" className={glyph} />
      </span>
      <span>{children}</span>
    </span>
  );
}
