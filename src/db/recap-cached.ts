import { cache } from "react";
import { getDb } from "./client";
import { getRecapPageState } from "./recap";

/**
 * **`/recap/[token]`'s state, read once per request** (code review
 * 2026-10-13b, item 32). The page's `generateMetadata` and its body each asked
 * for it, so every view read the recap twice: 28 statements twice over. React's
 * `cache()` memoizes per request and never longer, the same rule
 * `shopBySlugCached` keeps (`./shops-cached`); it takes only the booking id and
 * opens the database itself, because a memo keyed on an executor would miss.
 */
export const recapPageStateCached = cache(async (bookingId: string) =>
  getRecapPageState(await getDb(), bookingId),
);
