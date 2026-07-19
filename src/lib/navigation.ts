import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * The mutate-then-navigate pattern for server actions.
 *
 * A server action that writes to the database and then `redirect()`s can leave
 * the client showing pre-mutation data until a manual refresh: the redirect
 * re-renders the destination, but its cached RSC segment is served unless the
 * route is first marked stale. `revalidatePath` invalidates that cache so the
 * write is visible in the same round trip.
 *
 * Call this instead of a bare `redirect()` after any mutation. Pass the route
 * whose data changed as `path` (query string stripped — `revalidatePath` keys
 * on pathname); `to` is the full destination and defaults to `path`.
 *
 * Like `redirect`, this never returns — it throws to unwind the action.
 */
export function revalidateAndRedirect(path: string, to: string = path): never {
  revalidatePath(path);
  redirect(to);
}
