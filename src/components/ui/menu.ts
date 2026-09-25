import { SEGMENT_CORNER } from "@/components/ui/segmented";

/**
 * **A disclosed menu's parts: the panel, and the rows laid in it.**
 *
 * Three menus drop from the headers: the shop's identity menu, the phone's
 * When menu and the public language picker. Each spelled its own panel,
 * `rounded-inset … p-2`, and put `rounded-lg` rows in it: a 12px row 9px
 * inside a 12px corner, where a concentric curve is 3px (pixel-craft.md,
 * class 6). The probe flagged the identity menu's first and last rows
 * (`fill-corners` on `identity-menu-open`), and the When menu's lit "Today"
 * drew the same swollen corner at rest. **A menu panel is never spelled at a
 * call site**; `menu.test.ts` fails on one that is.
 *
 * **The panel takes the segmented track's inset, so its rows take the track's
 * corner.** One hairline and one `p-1` step put a row 5px inside the 12px
 * corner, where the concentric curve is `SEGMENT_CORNER`, 7px. Keeping `p-2`
 * and deriving 12 − 1 − 8 = 3px was the other way. It was not taken because it
 * adds a second derived radius to the ladder, and a 3px corner on a 44px row
 * reads as square. This way reuses the one derivation `segmented.test.ts`
 * already pins.
 */
export const MENU_PANEL = "rounded-inset border border-border bg-surface p-1 shadow-lg";

/**
 * **One text edge in a menu whose rows can carry a tick.** The identity menu
 * started its words at three edges, measured from the panel's padding box:
 * the LANGUAGE label at 16px (`px-2`), Settings and Sign out at 20px (`px-3`),
 * and the language names at 40px (`px-3`, the 12px tick column, `gap-2`).
 *
 * The tick column is what kept the language names on one edge whichever one
 * was current, so it stays. It is now this gutter, and every row and the group
 * label reserve it, so a row that never carries a tick (Settings, Sign out)
 * starts its words where a ticked one does. The gutter is 12px of the row's
 * own inset, the 12px tick and 8px before the words: `ps-8`. It is padding
 * rather than an empty column in each row because Sign out's words change as
 * it arms, and a padding edge does not depend on what the label is.
 */
export const MENU_TICK_GUTTER = "ps-8 pe-3";

/**
 * Where a row's tick sits: in the gutter, out of the words' flow and centred
 * on the row. Needs `menuRowClass`'s `relative`.
 */
export const MENU_TICK = "pointer-events-none absolute inset-y-0 start-3 flex w-3 items-center";

const MENU_ROW_TONES = {
  /** A row on offer. */
  quiet: "text-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-60",
  /** The row already in force, such as the language being read. */
  current: "bg-surface-sunken text-foreground",
  /**
   * A destructive row after its first tap: Sign out asking to be tapped
   * again. The warning is an inset ring, not a border. A border takes up
   * layout, so it would push the words 1px off the edge the moment the row
   * arms.
   */
  armed: "text-danger ring-1 ring-danger/40 ring-inset hover:bg-danger-tint disabled:opacity-60",
} as const;

export type MenuRowTone = keyof typeof MENU_ROW_TONES;

/**
 * One row of a menu that can carry a tick: a full-width 44px target on the
 * tick gutter, in the panel's derived corner. Tone is the only thing that
 * varies, so every row shares one edge, one corner and one height.
 *
 * Not `buttonClass`: its base carries `rounded-lg`, and Tailwind emits
 * utilities for one property in name order, so `rounded-lg` lands after an
 * arbitrary `rounded-[…]` and wins. A derived corner passed through its
 * `className` would be inert.
 */
export function menuRowClass(tone: MenuRowTone = "quiet"): string {
  return `relative flex min-h-11 w-full cursor-pointer items-center ${MENU_TICK_GUTTER} text-sm font-medium transition-colors disabled:cursor-wait ${SEGMENT_CORNER} ${MENU_ROW_TONES[tone]}`;
}
