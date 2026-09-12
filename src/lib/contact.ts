import { z } from "zod";

/**
 * Bounded emergency-contact fields shared by every place a diver can submit
 * one. Before CR-014, the waiver flow bounded these (max 120/40) but the
 * readiness page's equivalent action had no schema at all — an unbounded
 * `text` column and a caller that could write an arbitrarily long name/phone.
 * A single shared schema means the two flows can no longer drift apart.
 */
export const emergencyContactSchema = z.object({
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: z.string().trim().max(40).optional(),
});

export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;

/**
 * What a submitted pair of boxes means, decided once for every surface that
 * writes a diver's emergency contact.
 *
 * **The name and the number move together.** The waiver and readiness forms
 * both prefill from the record, so a blank box is a diver clearing it on
 * purpose; a writer that merged field by field (`if (name) …; if (phone) …`)
 * wrote a *new* name over the old one and kept the number that belonged to the
 * old contact. The manifest then carried a plausible-looking pair that dials
 * the wrong person on the worst day of the year — the hazard
 * `src/lib/emergency-reference.ts` names when it says a wrong number is worse
 * than an empty one. So a half-submission writes nothing and is refused where
 * the diver can see it.
 *
 * Both boxes blank is untouched: it is the no-change case, and a blank has
 * never overwritten what the shop has on file.
 */
export type EmergencyContactSubmission =
  | { kind: "pair"; name: string; phone: string }
  | { kind: "unchanged" }
  /** `missing` is the empty box, so a surface can put the refusal on it. */
  | { kind: "half"; missing: "name" | "phone" };

export function readEmergencyContact(input: {
  name?: string | null;
  phone?: string | null;
}): EmergencyContactSubmission {
  const name = input.name?.trim() ?? "";
  const phone = input.phone?.trim() ?? "";
  if (!name && !phone) return { kind: "unchanged" };
  if (!name) return { kind: "half", missing: "name" };
  if (!phone) return { kind: "half", missing: "phone" };
  return { kind: "pair", name, phone };
}
