import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { noticeUrl } from "./staff-notices";

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

/**
 * `revalidateWithNotice` pinned to one action file's code union, so a code the
 * page has no words for is a compile error at the call. Declared as a type
 * rather than inferred because TypeScript narrows on a `never` call only when
 * the callee's type is written out: `const done: NoticeRedirect<Notice> =
 * revalidateWithNotice;`.
 */
export type NoticeRedirect<Code extends string> = (
  path: string,
  notice: Code,
  extra?: Record<string, string | number | undefined>,
) => never;

/**
 * `revalidateAndRedirect` back onto `path` itself, carrying `?notice=` (and any
 * `extra` params, through `noticeUrl`). The one closing line a settings action
 * repeats on every branch; see `NoticeRedirect` for how a caller types it.
 */
export function revalidateWithNotice<Code extends string>(
  path: string,
  notice: Code,
  extra?: Record<string, string | number | undefined>,
): never {
  revalidateAndRedirect(path, noticeUrl(path, notice, extra));
}
