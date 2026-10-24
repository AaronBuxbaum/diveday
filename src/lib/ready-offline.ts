/**
 * **Keep this diver's trip-prep page on their phone** (the `/ready/` worker,
 * `src/worker/ready-page-cache.ts`). Registers the one service-worker script
 * under the narrowest scope that covers the page — `/ready/`, never `/` — and
 * asks it, once active, to keep the copy of the page that asked.
 *
 * Silent by design: a browser without service workers, a private window, a
 * full disk or a refused fetch all leave the page exactly as it was online,
 * and there is nobody to tell.
 */
export const READY_WORKER_SCOPE = "/ready/";

/** The Cache Storage cache that holds the one kept copy (`src/worker/ready-page-cache.ts`). */
export const READY_CACHE_NAME = "diveday-ready-page-v1";

/**
 * The `<meta name>` the live trip-prep page carries to say **until when** the
 * phone may keep its copy (security review of layer 8, D2). The worker keeps
 * no copy of a page without it, so a cancelled booking, a departure called
 * off or a dead link clears the copy on its next load rather than replacing it.
 */
export const READY_KEEP_UNTIL_META = "diveday-ready-keep-until";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant (epoch ms) the phone's copy of this page stops being served: a
 * day after the boat is due back, or, with no return time, a day after it
 * leaves. Only the live page names one; a departure called off renders a
 * terminal card that names none, which clears the copy.
 */
export function readyCopyKeepUntil(trip: { startsAt: Date; endsAt?: Date | null }): number {
  return (trip.endsAt ?? trip.startsAt).getTime() + DAY_MS;
}

const ACTIVATE_TIMEOUT_MS = 10_000;

function activeWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (registration.active) return Promise.resolve(registration.active);
  const pending = registration.installing ?? registration.waiting;
  if (!pending) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ACTIVATE_TIMEOUT_MS);
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") {
        clearTimeout(timer);
        resolve(pending);
      } else if (pending.state === "redundant") {
        clearTimeout(timer);
        resolve(null);
      }
    });
  });
}

export async function keepReadyPageOnDevice(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.register("/manifest-sw.js", {
      scope: READY_WORKER_SCOPE,
    });
    const worker = await activeWorker(registration);
    if (!worker) return false;
    return await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        resolve(false);
      }, ACTIVATE_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data?.ok === true);
      };
      worker.postMessage({ type: "KEEP_READY_PAGE" }, [channel.port2]);
    });
  } catch {
    return false;
  }
}

/**
 * **Take the kept copy off this browser** (issue #2693): "Remove saved copy" on
 * `/ready`, and every staff sign-out (`forgetThisDevice`), since a shop tablet
 * that opened a diver's link may still hold their page. Deletes the copy's
 * cache and unregisters the diver's `/ready/` worker, so no later load on this
 * browser keeps it again until the link is next opened. The staff worker at
 * `/` stays: it holds the crew's offline manifests.
 *
 * Answers whether the cache could be reached; never throws.
 */
export async function forgetReadyPageCopy(): Promise<boolean> {
  try {
    if (typeof caches === "undefined" || !caches) return false;
    await caches.delete(READY_CACHE_NAME);
    const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (worker) {
      for (const registration of await worker.getRegistrations()) {
        if (new URL(registration.scope).pathname === READY_WORKER_SCOPE) {
          await registration.unregister();
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
