import { z } from "zod";
import { DECK_COUNT_MAX } from "@/lib/deck-count";

/**
 * The deck count form's one field. **A blank field is no count, never a count
 * of zero** (attacker review S6): `z.coerce.number()` read "" as 0, so a post
 * with the field dropped would have stood as "You count 0". Digits only, so
 * "1e2" and "0x0c" are refused too.
 */
export const deckCountSchema = z.object({
  counted: z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(DECK_COUNT_MAX)),
});
