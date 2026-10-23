import { useEffect, useRef } from "react";

/** How long between two asks of the live manifest, once one has come back empty. */
export const LIVE_RETRY_MS = 5_000;

/**
 * How long one ask waits. Longer than the worker's four-second deadline on
 * purpose: this ask runs behind a page that is already usable, so a server
 * that answers in eight seconds still brings the captain back.
 */
export const LIVE_ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * **Back to the live manifest once DiveDay answers** (captain review B1).
 *
 * The service worker serves the saved copy when the live manifest is slow,
 * not only when the device is offline, and on that link the browser never
 * fires `online`: it never went offline. So this asks the live page itself,
 * every `LIVE_RETRY_MS`, and opens it the first time it answers.
 *
 * The ask is an ordinary `fetch`, not a navigation, so the worker lets it
 * through to the network with no deadline of its own. A redirect (a session
 * that has ended sends the page to sign-in) is not an answer: leaving the
 * roll call for a sign-in form would be worse than staying on the copy.
 *
 * `canLeave` is asked at the moment of leaving. A tap still being written to
 * this phone, or a sentence typed about a missing diver and not yet sent,
 * holds the captain here until the next answer.
 */
export function useLiveReturn(
  liveHref: string | null,
  canLeave: () => boolean,
  /** How the page is left; a test passes its own, as jsdom cannot navigate. */
  open: (href: string) => void = (href) => window.location.replace(href),
) {
  const canLeaveRef = useRef(canLeave);
  canLeaveRef.current = canLeave;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
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
        if (answered && canLeaveRef.current()) {
          openRef.current(liveHref);
          return;
        }
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
}
