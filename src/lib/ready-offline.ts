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
 * Where the worker notes each readiness link's forget epoch (issue #2979), by
 * a hash of its path: an earlier fetch cannot restore a cancelled copy, even
 * after a device-clock change or worker restart. Apart from the copy's cache
 * so that one holds the copy alone.
 */
export const READY_FORGOTTEN_CACHE_NAME = "diveday-ready-forgotten-v1";

/**
 * The `<meta name>` the live trip-prep page carries to say **until when** the
 * phone may keep its copy (security review of layer 8, D2). The worker keeps
 * no copy of a page without it, so a cancelled booking, a departure called
 * off or a dead link clears the copy on its next load rather than replacing it.
 */
export const READY_KEEP_UNTIL_META = "diveday-ready-keep-until";

/**
 * Marks the page's "No signal" line, which the server draws hidden. The
 * worker shows it in the kept copy (issue #3003): that copy runs no script,
 * and it is only ever on screen when the network did not answer.
 */
export const READY_OFFLINE_NOTE_ATTR = "data-ready-offline-note";

/** The server-rendered timestamp placeholder the readiness worker fills when it saves the page. */
export const READY_OFFLINE_GENERATED_AT_PLACEHOLDER = "__diveday_ready_generated_at__";

/** The locale and shop time zone the worker uses to format the saved instant. */
export const READY_COPY_LOCALE_META = "diveday-ready-copy-locale";
export const READY_COPY_TIME_ZONE_META = "diveday-ready-copy-time-zone";
/** Server clock instant when this live readiness page was rendered. */
export const READY_COPY_GENERATED_AT_META = "diveday-ready-copy-generated-at";
/** Distinguishes copies with the saved-time banner from older cached markup. */
export const READY_COPY_VERSION_META = "diveday-ready-copy-version";
export const READY_COPY_VERSION = "saved-time-v1";
/** The save instant attached to the timestamped offline banner by the worker. */
export const READY_COPY_GENERATED_AT_ATTR = "data-ready-copy-generated-at";

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
 * **A cancelled seat takes its copy with it** (issue #2979, security review
 * 2026-10-24, finding 1). A self-cancel is a server action, and a hydrated
 * page follows its redirect without a navigation the worker can see, so the
 * card the cancel lands on asks the worker controlling it to forget this
 * page's copy (by its own path: another booking's copy stays). Answers
 * whether the worker said it did; never throws.
 */
export async function forgetThisReadyPage(): Promise<boolean> {
  try {
    const worker =
      typeof navigator === "undefined" ? undefined : navigator.serviceWorker?.controller;
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
      worker.postMessage({ type: "FORGET_READY_PAGE" }, [channel.port2]);
    });
  } catch {
    return false;
  }
}

/**
 * **Take the kept copy off this browser** (issue #2693): "Remove saved copy" on
 * `/ready`, and every staff sign-out (`forgetThisDevice`), since a shop tablet
 * that opened a diver's link may still hold their page. Unregisters the
 * diver's `/ready/` worker first and only then deletes the copy's cache, so a
 * save another tab's worker was making cannot land after the delete (security
 * review 2, N2). The staff worker at `/` stays: it holds the crew's offline
 * manifests.
 *
 * A worker already controlling an open tab keeps running until that tab
 * closes, and opening the link again keeps the page again, so the copy is
 * gone **until the link is next opened** — what "Removed" says.
 *
 * One step failing does not skip the other. Answers whether the cache was
 * deleted; never throws.
 */
export async function forgetReadyPageCopy(): Promise<boolean> {
  const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (worker) {
    try {
      const registrations = await worker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => new URL(registration.scope).pathname === READY_WORKER_SCOPE)
          .map((registration) => registration.unregister().catch(() => false)),
      );
    } catch {
      // No registrations to read: still delete the copy below.
    }
  }
  try {
    if (typeof caches === "undefined" || !caches) return false;
    await caches.delete(READY_CACHE_NAME);
    // The forget markers too (#2979): they guard against a save landing
    // after a forget, and with this registration gone none can, so a shared
    // device keeps no hash of the link's path either.
    await caches.delete(READY_FORGOTTEN_CACHE_NAME);
    return true;
  } catch {
    return false;
  }
}
