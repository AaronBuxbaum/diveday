/**
 * Bidirectional keyset paging for the public schedule list (task 17,
 * docs/product/archive/ux-personas-20260730-findings.md). `pagedUpcomingTripsWithCounts`
 * (src/db/trips.ts) only ever pages forward from a cursor — there is no
 * "before" query. Rather than add one, the page itself remembers every
 * cursor it has already shown in a small stack carried in the URL's `back`
 * parameter: paging forward pushes the current cursor onto the stack, paging
 * backward pops the most recent one back off. Framework-free and pure so the
 * stack shape has its own tests independent of the page that renders it.
 */

/** The stack of `after` cursors for every page already shown, oldest first. An empty string stands for "the first page" (no `after` at all). */
export type CursorStack = string[];

/** Encode a cursor stack for a URL's `back` query parameter. */
export function encodeCursorStack(stack: CursorStack): string {
  return encodeURIComponent(JSON.stringify(stack));
}

/** Decode a `back` query parameter back into a cursor stack — `[]` for anything absent or malformed, never a thrown error on a tampered URL. */
export function decodeCursorStack(raw: string | undefined | null): CursorStack {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

/** The stack to carry forward after paging to `nextCursor` from a page whose own cursor was `currentAfter`. */
export function pushCursor(stack: CursorStack, currentAfter: string | undefined): CursorStack {
  return [...stack, currentAfter ?? ""];
}

/**
 * Pop the most recent cursor off the stack: the `after` to request for the
 * previous page (undefined for its first page) and the stack that page
 * should itself carry. Null when the stack is already empty — there is no
 * previous page to go back to.
 */
export function popCursor(
  stack: CursorStack,
): { after: string | undefined; stack: CursorStack } | null {
  if (stack.length === 0) return null;
  const previous = stack[stack.length - 1];
  return { after: previous || undefined, stack: stack.slice(0, -1) };
}
