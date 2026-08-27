"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * **After a publish, keep what was published on screen.**
 *
 * The "Waiting on you" filter is a list of reviews that are, by definition, no
 * longer in it the moment you act on one. Publishing from that tab used to
 * answer by *redirecting* to the unfiltered list — "it lands back on the whole
 * list, so you see what you just released" — and that redirect was the one
 * useful thing the page's navigation was doing. Dropping it wholesale would
 * have replaced a full-page bounce with a row vanishing under the cursor and,
 * on a pass that cleared the queue, an empty page where the confirmation should
 * have been.
 *
 * So the behaviour stays and only the mechanism changes: `router.replace` to
 * the same route without the filter. Same destination the redirect had, minus
 * the document teardown — the shell stays mounted, the viewport stays put
 * (`scroll: false`), and this component tree is *not* remounted, which is what
 * lets the `useActionState` result that triggered it survive to be rendered on
 * the list it moved you to.
 *
 * `replace`, not `push`: clearing a queue is one act, not a history entry a
 * staffer has to press Back through to leave the page.
 *
 * Takes the filter as a value rather than reading `useSearchParams()`, which
 * would opt this page's whole subtree out of its static shell — the thing
 * `export const instant = true` and `loading.tsx` exist to guarantee (ADR
 * 20260804-instant-navigation). The server already knows the answer.
 */
export function useRevealPublished(published: boolean, showingWaitingOnly: boolean): void {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!published || !showingWaitingOnly) return;
    router.replace(pathname, { scroll: false });
  }, [published, showingWaitingOnly, pathname, router]);
}
