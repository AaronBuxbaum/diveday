import { z } from "zod";

/** Stable, intentionally small vocabulary for shop-stated conservation work. */
export const CONSERVATION_COMMITMENTS = [
  "aware_partner",
  "green_fins_member",
  "reef_cleanup",
  "mooring_buoys",
  "no_gloves",
  "wildlife_distance",
] as const;

export type ConservationCommitment = (typeof CONSERVATION_COMMITMENTS)[number];

const commitmentSchema = z.enum(CONSERVATION_COMMITMENTS);

export function parseConservationCommitments(value: unknown): ConservationCommitment[] {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.flatMap((item) => commitmentSchema.safeParse(item).data ?? []))];
}

export function parseConservationNote(value: unknown): string | null {
  const parsed = z
    .string()
    .trim()
    .max(600)
    .safeParse(value ?? "");
  return parsed.success && parsed.data ? parsed.data : null;
}
