import { z } from "zod";

/** Quantified actions, never a standing policy or an estimate of ecological impact. */
export const CONSERVATION_KINDS = [
  "litter_kg",
  "litter_items",
  "line_m",
  "lionfish_count",
] as const;
export type ConservationKind = (typeof CONSERVATION_KINDS)[number];
export const conservationFactSchema = z
  .object({
    kind: z.enum(CONSERVATION_KINDS),
    quantity: z.coerce.number().finite().positive().max(100000).multipleOf(0.01),
    location: z.string().trim().max(120),
    note: z.string().trim().max(500),
  })
  .refine(
    (fact) =>
      !["litter_items", "lionfish_count"].includes(fact.kind) || Number.isInteger(fact.quantity),
    {
      path: ["quantity"],
    },
  );
export type ConservationFactInput = z.infer<typeof conservationFactSchema>;

/** Only the recorded facts cross to a diver, with no staff ids or private fields. */
export type ConservationFact = ConservationFactInput & { id: string };
