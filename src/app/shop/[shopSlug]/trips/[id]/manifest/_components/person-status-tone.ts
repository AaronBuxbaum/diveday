import type { RollCallRowState } from "@/lib/manifests";

export type PersonStatusTone = "danger" | "success" | "warning" | "neutral";

/**
 * The ink a person sheet's status line wears (visual review 2026-10-24, B08):
 * the same four-way reading the chip it replaces had, so a person not back
 * aboard still reads in danger and an unmarked one stays plain.
 */
export function personStatusTone(
  rowState: Pick<
    RollCallRowState,
    "notBackAboard" | "boarded" | "recordedNotBoarded" | "impliedNotBoarded"
  >,
): PersonStatusTone {
  if (rowState.notBackAboard) return "danger";
  if (rowState.boarded) return "success";
  if (rowState.recordedNotBoarded || rowState.impliedNotBoarded) return "warning";
  return "neutral";
}
