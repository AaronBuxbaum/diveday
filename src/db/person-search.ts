import { ilike, or, type SQL, sql } from "drizzle-orm";
import { MIN_PHONE_SEARCH_DIGITS, phoneDigits } from "@/lib/person-fields";
import { people } from "./schema";

/**
 * **One predicate for "a staffer typed something into a box that looks for a
 * person".** Name, email, phone — the same three columns, compared the same
 * way, wherever the box is: the command palette (`src/db/search.ts`), the diver
 * roster and the returning-diver picker (`src/db/divers.ts`), and the counter's
 * queue and its not-on-today's-list lookup (`src/db/check-in.ts`).
 *
 * It is one function because five copies of it had already drifted, and the
 * drift was visible on a single screen. The palette normalised a phone query to
 * digits; the roster, the picker and the counter's not-on-today's-list lookup
 * compared the raw query to the stored string; the counter's *queue* did not
 * look at a phone at all. Since #1712 those surfaces *display* a grouped
 * number (`+1 305 555 0142`, `displayStoredPhone`) while `people.phone` holds
 * E.164 (`+13055550142`, `phoneForStorage`) — so a staffer who selected the
 * number off a diver's record and pasted it into the search box got an empty
 * list, because `%+1 305 555 0142%` does not occur in `+13055550142` (issue
 * #1765). The check-in page did both halves thirty lines apart: matched raw at
 * the query, printed grouped at the row.
 *
 * ## Both sides are normalised, and both sides are indexed
 *
 * The needle is stripped to digits **and** the column is stripped to digits.
 * Neither half is sufficient on its own:
 *
 * - Needle only would fix an E.164 row by luck — `13055550142` happens to be a
 *   substring of `+13055550142` — and would still miss every row holding text
 *   `toE164` could not resolve, which `people.phone` is explicitly allowed to
 *   hold: `+1 305 555 0142 x21`, a dashed number a CSV carried in
 *   (`phoneForStorage`, src/lib/phone.ts). Those are the rows a shop most needs
 *   to find, because nothing about them is canonical.
 * - Column only would mean re-punctuating the query to match, which is the
 *   defect being fixed.
 *
 * The stored-side strip is an expression, not a column reference, and it is
 * backed by its own GIN trigram index (`people_phone_digits_trgm_idx`,
 * src/db/schema.ts) alongside the plain one on the column
 * (`people_phone_trgm_idx`). **So the digits comparison costs an index lookup,
 * not a sequential scan** — the earlier note here said the opposite, which was
 * true for the four days between the expression landing and the index that
 * backs it. The price of the column-side normalisation is therefore one more
 * GIN index to maintain on every write of `people.phone`, plus a coupling no
 * compiler can see: the expression below must stay character-for-character
 * identical to the schema's, or Postgres matches neither and every phone query
 * becomes the scan. `src/db/search-indexes.test.ts` compares the two source
 * texts for exactly that reason.
 *
 * The raw `ilike` is *added to* rather than replaced by the digits comparison.
 * It is what still finds the non-digit half of a stored value — the query `x21`
 * against `+1 305 555 0142 x21`, a note a shop typed into the field — and it is
 * indexed too, so keeping it costs a second arm on a bitmap OR and nothing
 * else.
 *
 * ## A query with no calling code matches on purpose
 *
 * `305 555 0142` finds `+13055550142`, because `3055550142` is a substring of
 * that row's digits. That is the same mechanism that fixes the pasted grouped
 * form rather than a second rule, and it is **deliberate, not a leftover**: a
 * staffer reading a number off a handwritten card or a caller ID has no calling
 * code to type, and DiveDay cannot ask them for one — `toE164` needs the shop's
 * country to put a code in front, and the whole point of storing E.164 was to
 * stop read-time answers depending on the shop's *current* address setting
 * (`storedPhone`, src/db/person-phone.ts). An anchored match would refuse the
 * most common way a number gets typed at a counter. The cost is that a
 * ten-digit needle can match a row in another country whose national number
 * ends the same way, which is a longer list, never a wrong one.
 *
 * ## It carries no scope, and the callers' scopes are not identical
 *
 * This predicate names three columns and nothing else: no shop, no role, no
 * `deleted_at`. Every caller keeps its own, and a reader must not take this
 * function for the place tenancy is enforced. The five are not uniform, which
 * is worth writing down rather than asserting away (`security-reviewer`, issue
 * #1765):
 *
 * - `src/db/divers.ts` (both readers) and `listOtherMatchingDivers` in
 *   `src/db/check-in.ts` carry all three — shop, a `person_roles` join, and the
 *   soft-delete scope.
 * - `src/db/search.ts` (the command palette) carries shop and `deleted_at` but
 *   **no role join**, so a staffer typing a punctuated number can surface a
 *   colleague's stored phone. Inside one tenant, and `/api/search` gates on a
 *   live staff-role read, but it is not the same scope as the roster's.
 * - `listCheckInQueue` in `src/db/check-in.ts` is a booking query: it carries
 *   `bookings.shopId` *and* `trips.shopId`, and **no `deleted_at is null`** —
 *   a soft-deleted person still on a live booking in the arrivals window shows
 *   up, which is arguably the right answer at a counter and is certainly not
 *   what "every call site keeps all three" would have told you.
 *
 * ## The digit floor
 *
 * Below {@link MIN_PHONE_SEARCH_DIGITS} the query is compared to the phone
 * column as typed and nothing else. Two reasons, both still live now that the
 * expression is indexed: `like '%55%'` yields no complete trigram, so pg_trgm
 * extracts nothing from it and the index cannot serve it — the short query is
 * the one that really would scan — and a two-digit needle matches most of the
 * shop anyway, which is not an answer. A short query stays a name query.
 */
export function personSearchMatch(rawQuery: string): SQL | undefined {
  const query = rawQuery.trim();
  if (!query) return undefined;
  const like = `%${query}%`;
  const digits = phoneDigits(query);
  const phoneMatch =
    digits.length >= MIN_PHONE_SEARCH_DIGITS
      ? or(
          ilike(people.phone, like),
          sql`regexp_replace(coalesce(${people.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`,
        )
      : ilike(people.phone, like);
  return or(ilike(people.fullName, like), ilike(people.email, like), phoneMatch);
}
