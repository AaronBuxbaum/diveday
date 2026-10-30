import { ilike, or, type SQL, sql } from "drizzle-orm";
import { MIN_PHONE_SEARCH_DIGITS, phoneDigits } from "@/lib/person-fields";
import { people } from "./schema";

/**
 * A typed needle as `like` reads it literally: `%`, `_` and the escape
 * character itself each take Postgres's default `like` escape, a backslash.
 * Unescaped, a lone `%` in a search box listed every person in the shop
 * (security review of #2579).
 */
function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/**
 * Literal, case-insensitive substring search across name, email and phone.
 * For phone needles at least {@link MIN_PHONE_SEARCH_DIGITS} digits long, match
 * both the raw stored value and its digits-only form. The raw arm preserves
 * extensions and other free text in `people.phone`; unanchored matching also
 * lets a local number find an E.164 value without a country code.
 *
 * Keep the digits SQL expression identical to the expression index in
 * `src/db/schema/core.ts` (`people_phone_digits_trgm_idx`); the source check in
 * `src/db/search-indexes.test.ts` enforces that coupling. Shorter phone needles
 * use only the raw match because they cannot use a trigram index and are too
 * broad to return useful phone results.
 *
 * This predicate adds no tenant, role or live-row scope. Every caller must
 * supply the scope appropriate to its surface. In particular, the command
 * palette scopes to the shop and live people but has no person-role filter, so
 * it can surface a colleague's stored phone within that tenant.
 */
export function personSearchMatch(rawQuery: string): SQL | undefined {
  const query = rawQuery.trim();
  if (!query) return undefined;
  const like = `%${escapeLikePattern(query)}%`;
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
