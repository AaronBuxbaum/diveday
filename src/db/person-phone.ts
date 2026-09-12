import { eq } from "drizzle-orm";
import { phoneForStorage } from "@/lib/phone";
import type { DbExecutor } from "./client";
import { shops } from "./schema";

/**
 * The form a diver's phone number is written in: E.164 (`+13055550110`), read
 * against the country the shop itself is in (`shops.address_country`, ISO
 * 3166-1 alpha-2, nullable).
 *
 * One shape in the column is what lets an inbound SMS or WhatsApp find the
 * record it belongs to (`phoneMatches`) and what a shop's export hands to any
 * other system. **Every** writer of `people.phone` goes through this or through
 * its pure half (`phoneForStorage`, for the importer, which already holds the
 * shop row): `createDiver` and `updateDiver` (src/db/divers.ts),
 * `findOrCreatePerson` (src/db/people.ts) and therefore the public booking,
 * wait-list, last-minute-list and self-registration doors,
 * `createPhoneOnlyPerson` (src/db/self-registration.ts), the no-email booking
 * insert (src/db/bookings.ts), the seat claimant's contact write
 * (src/db/seat-claims.ts), and both halves of the contact importer
 * (src/db/import.ts). That list is the contract; a new writer joins it.
 *
 * It was not always all of them, and the gap was not cosmetic. The stored side
 * used to be re-resolved against the shop's country on **every** inbound
 * message (`matchPersonByAddress`), so a row holding a bare `7700900123` meant
 * `+447700900123` while the shop said GB and `+17700900123` the moment an owner
 * edited the address to US — a stranger's SMS filed onto a named diver, and a
 * staffer answering that thread sends to the sender, never to the address on
 * file (security-reviewer finding). Normalising on write is what takes the
 * setting out of the meaning.
 *
 * **What happens to a number `toE164` cannot read** — a shop with no country on
 * file, a country DiveDay has no calling code for, an extension, a note, a
 * count of digits no country explains: the trimmed text the staffer typed is
 * stored exactly as they typed it. Never blanked, never half-rewritten. A
 * number DiveDay cannot parse is still the only way that shop can reach that
 * diver, and `toE164`'s own comment lists every shape it does and does not read.
 *
 * **The emergency contact's number is deliberately not touched.** Nothing
 * matches on it; a crew reads it off a manifest and dials it, and a number
 * rewritten on a safety document is the failure that rule exists to prevent.
 */
export async function storedPhone(
  db: DbExecutor,
  shopId: string,
  typed: string | null | undefined,
): Promise<string | null> {
  if (!typed?.trim()) return null;
  const [shop] = await db
    .select({ country: shops.addressCountry })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return phoneForStorage(typed, shop?.country);
}
