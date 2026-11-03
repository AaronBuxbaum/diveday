/**
 * How the departure log's two roll-call tables size their checkpoint columns:
 * the one thing on that sheet whose column count is not fixed. Each is three
 * text columns (diver, emergency contact, buddy team; crew member, roles,
 * teams) plus one per checkpoint, and a checkpoint is a dive.
 * `rollCallCheckpoints` allows up to five dives on a course session, so this
 * answers for two to six checkpoints, five to nine columns.
 *
 * **The log is a sheet** (issue #2745): what an owner reviews on screen is the
 * page that comes out, so the tables have the sheet's width and no scroll
 * floor, and a checkpoint takes the same share on both.
 *
 * Two-branch picks rather than arithmetic, because a computed `w-[${n}%]`
 * typechecks, lints and renders with no width at all: Tailwind's scanner never
 * sees the class (issue #1052).
 */

/**
 * A checkpoint column's share of the sheet's ~700px. 13% is ~90px, which holds
 * the widest word a checkpoint column carries, "DEPARTURE" (~71px in the
 * header's tracked 12px capitals), after the column's 16px of left padding;
 * "Awaiting roll call" wraps once under it. At three checkpoints the diver,
 * contact and buddy columns then get ~150px each, where six equal columns left
 * them 125px and a buddy cell ran four and five lines (K-104,
 * DEPARTURE-8-20). Five checkpoints already share equally at 12.5%, under
 * 13%, so there the pin is released and nothing is taken from the names; six
 * print as segments of two (`DepartureRoster`), which share equally too.
 */
export function rollCallCheckpointClass(checkpointCount: number): string {
  return checkpointCount >= 5 ? "w-auto" : "w-[13%]";
}
