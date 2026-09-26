import type { TableMinWidth } from "@/components/ui/table";

/**
 * How the departure log's two roll-call tables size their columns: the one
 * thing on that page whose column count is not fixed. Each is three text
 * columns (diver, emergency contact, buddy team; crew member, roles, teams)
 * plus one per checkpoint, and a checkpoint is a dive. `rollCallCheckpoints`
 * clamps to 1..4 dives (as does the `trips_planned_dives_range` check
 * constraint), so these answer for two to five checkpoints, five to eight
 * columns, and there is no ninth case to miss.
 *
 * Two-branch picks rather than arithmetic, because `Table`'s widths are static
 * maps of literal Tailwind classes: a computed `min-w-[${n}rem]` or
 * `w-[${n}%]` typechecks, lints and renders with no width at all, since the
 * scanner never sees the class. The arithmetic lives here rather than in
 * `Table` for the reason that component's own doc gives — its width props are
 * a hint about a table's strategy, not a layout escape hatch, and this page is
 * the only call site with a column count to count (issue #1052).
 */

/**
 * The scroll floor on screen. Every checkpoint column is pinned at 8rem
 * (`Th width="8rem"`) and the three text columns share the rest, so at the
 * `56rem` floor two checkpoints leave them ~213px each and three ~171px, and at
 * `72rem` four leave ~213px and five ~171px. Four checkpoints at `56rem` would
 * leave 128px and five 85px: the crush issue #1035 measured, back on a shop
 * that runs more dives per departure than the seed does.
 */
export function rollCallTableMinWidth(checkpointCount: number): TableMinWidth {
  return checkpointCount >= 4 ? "72rem" : "56rem";
}

/**
 * A checkpoint column's width on paper, where the table has only the page's
 * ~750px: the screen floor is released there (`print:min-w-0`), and five 8rem
 * pins would be 640px of it. 13% is ~97px, which holds the widest word a
 * checkpoint column carries, "DEPARTURE" (~71px in the header's tracked 12px
 * capitals), after the column's 16px of left padding; "Awaiting roll call"
 * wraps once under it. At three checkpoints the diver, contact and buddy
 * columns then get ~152px each, where six equal columns left them 125px and
 * a buddy cell ran four and five lines (K-104, DEPARTURE-8-20). Five
 * checkpoints already share equally at 12.5%, under 13%, so there the pin is
 * released and nothing is taken from the names.
 */
export function rollCallCheckpointPrintClass(checkpointCount: number): string {
  return checkpointCount >= 5 ? "print:w-auto" : "print:w-[13%]";
}
