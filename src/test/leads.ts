import type { leads } from "@/db/schema";

/**
 * A diver-asked departure lead as a test inserts one: the wait-list row the
 * public form writes. Pass `askedBy: "shop"` for cold outreach, or any column
 * the test is about.
 */
export function departureLead(
  row: Pick<typeof leads.$inferInsert, "shopId" | "tripId" | "personId"> &
    Partial<typeof leads.$inferInsert>,
): typeof leads.$inferInsert {
  return { scope: "departure", askedBy: "diver", partySize: 1, ...row };
}
