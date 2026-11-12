import { z } from "zod";

/** Self-authored public information, separate from consent to a crew name. */
export const publicStaffProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  role: z.string().trim().max(80),
  sinceYear: z.number().int().min(1900).max(2100).nullable(),
  languages: z.string().trim().max(160),
  description: z.string().trim().max(1000),
  photoUrls: z.array(z.string()).max(4),
});
export type PublicStaffProfile = z.infer<typeof publicStaffProfileSchema>;
