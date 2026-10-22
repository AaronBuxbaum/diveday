import type { interests } from "@/db/schema";

/**
 * A diver-asked departure interest as a test inserts one: the wait-list row the
 * public form writes. Pass `askedBy: "shop"` for cold outreach, or any column
 * the test is about.
 */
export function departureInterest(
  row: Pick<typeof interests.$inferInsert, "shopId" | "tripId" | "personId"> &
    Partial<typeof interests.$inferInsert>,
): typeof interests.$inferInsert {
  return { scope: "departure", askedBy: "diver", partySize: 1, ...row };
}
