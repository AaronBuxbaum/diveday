import { z } from "zod";
import { type DiveSpecialty, diveSpecialty } from "@/db/schema";

const specialtiesSchema = z.array(z.enum(diveSpecialty.enumValues));

/**
 * The specialty cards ticked on a `RequirementFields` form (repeated
 * `specialty`), or null when any value is not a specialty. A dive site and a
 * departure read the boxes here, so a crafted post is refused the same way by
 * both rather than by whichever action happened to respell the check.
 */
export function readRequiredSpecialties(formData: FormData): DiveSpecialty[] | null {
  const parsed = specialtiesSchema.safeParse(formData.getAll("specialty").map(String));
  return parsed.success ? parsed.data : null;
}
