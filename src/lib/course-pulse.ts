import type { TripRequirement } from "@/db/schema";
import type { ParticipantType } from "./participant-types";
import type { ReadinessResult } from "./readiness";
import { buildDiverChecklist } from "./readiness-summary";

export const COURSE_TEACHING_NOTE_MAX = 600;

export type CoursePrepItem = "forms" | "card" | "payment" | "materials" | "staff";

/** Category-only preparation: no answers, clinical reasons, or boarding claim. */
export function coursePrepItems(input: {
  requirement: TripRequirement | null;
  readiness: ReadinessResult;
  participantType: ParticipantType;
  materialsAsked: boolean;
  materialsDone: boolean;
}): CoursePrepItem[] {
  const items = new Set<CoursePrepItem>();
  for (const item of buildDiverChecklist(input.requirement, input.readiness, input)) {
    if (item.state === "done") continue;
    if (item.state === "waiting") items.add("staff");
    else if (item.category === "waiver") items.add("forms");
    else if (item.category === "certification") items.add("card");
    else if (item.category === "payment") items.add("payment");
  }
  if (input.materialsAsked && !input.materialsDone) items.add("materials");
  return [...items];
}
