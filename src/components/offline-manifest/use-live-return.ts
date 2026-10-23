import { useEffect, useState } from "react";

/** How long between two asks of the live manifest. */
export const LIVE_RETRY_MS = 5_000;

/**
 * How long one ask waits: under the worker's four-second navigation deadline
 * (`NAVIGATION_TIMEOUT_MS`, src/worker/manifest-sw.ts), with room for the
 * navigation's own overhead. An ask that succeeds has to predict that opening
 * the live manifest will land there. With a longer budget, a server that
 * answers in a steady five seconds passed the ask and failed the navigation,
 * and the captain bounced back to the copy (layer 1 re-review, R1).
 */
export const LIVE_ATTEMPT_TIMEOUT_MS = 3_000;

/**
 * **Whether DiveDay is answering the live manifest again** (captain review
 * B1, re-review R1).
 *
 * The service worker serves the saved copy when the live manifest is slow,
 * not only when the device is offline, and on that link the browser never
 * fires `online`: it never went offline. So this asks the live page itself,
 * every `LIVE_RETRY_MS`, and says whether the last ask was answered in time.
 *
 * It never leaves the page. Swapping the list under a captain in the middle of
 * a count moved the rows under a wet thumb and could drop a typed sentence on
 * unload; the screen offers the live manifest instead, and the captain
 * chooses when.
 *
 * The ask is an ordinary `fetch`, not a navigation, so the worker lets it
 * through to the network. A redirect (a session that has ended sends the page
 * to sign-in) is not an answer.
 */
export function useLiveAnswering(liveHref: string | null): boolean {
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    setAnswering(false);
    if (!liveHref) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt: AbortController | undefined;

    const ask = async () => {
      if (!navigator.onLine) return false;
      const controller = new AbortController();
      attempt = controller;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const givenUp = new Promise<null>((resolve) => {
        deadline = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, LIVE_ATTEMPT_TIMEOUT_MS);
      });
      const asked = fetch(liveHref, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      try {
        // Raced as well as aborted, as the worker's deadline is: an ask that
        // ignores its signal must not end the asking.
        const response = await Promise.race([asked, givenUp]);
        if (!response) return false;
        // Only the headers were wanted; the body is the whole roster.
        void response.body?.cancel().catch(() => undefined);
        return response.ok && !response.redirected;
      } catch {
        return false;
      } finally {
        clearTimeout(deadline);
        asked.catch(() => undefined);
      }
    };

    const next = () => {
      timer = setTimeout(async () => {
        const answered = await ask();
        if (stopped) return;
        setAnswering(answered);
        next();
      }, LIVE_RETRY_MS);
    };
    next();

    return () => {
      stopped = true;
      clearTimeout(timer);
      attempt?.abort();
    };
  }, [liveHref]);

  return answering;
}
