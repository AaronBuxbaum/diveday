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
