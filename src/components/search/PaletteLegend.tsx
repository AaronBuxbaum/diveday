import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import type { CommandPaletteCopy } from "./CommandPalette";

/**
 * The palette's own key cap — smaller than the header button's ⌘K badge.
 *
 * A fixed 16px box that centres what it holds, because the caps hold two
 * kinds of thing: a word or a glyph (↵, esc) and a 12px drawn arrow. Sized by
 * their content, the arrow caps' line box made them 18px beside the text caps'
 * 16 in the same legend (the pixel audit, command-palette).
 */
export const hintKeyClass =
  "inline-flex h-4 items-center rounded border border-border bg-surface-sunken px-1.5 font-sans text-[0.65rem] leading-none font-semibold";

/** Decorative key hints; the combobox already announces its keyboard controls. */
export function PaletteLegend({
  copy,
}: {
  copy: Pick<CommandPaletteCopy, "hintMove" | "hintOpen" | "hintClose">;
}) {
  return (
    <p
      aria-hidden="true"
      className="[@media(pointer:coarse)]:hidden flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-2.5 text-xs text-muted"
    >
      <span className="inline-flex items-center gap-1.5">
        <kbd className={hintKeyClass}>
          <DiveDayIcon name="arrow-up" className="size-3" />
        </kbd>
        <kbd className={hintKeyClass}>
          <DiveDayIcon name="arrow-down" className="size-3" />
        </kbd>
        {copy.hintMove}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <kbd className={hintKeyClass}>↵</kbd>
        {copy.hintOpen}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <kbd className={hintKeyClass}>esc</kbd>
        {copy.hintClose}
      </span>
    </p>
  );
}
