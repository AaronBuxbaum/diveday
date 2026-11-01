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
 * **The offline snapshot's address** (issue #3225): `/ready/<token>/offline`, a
 * JSON document the server builds for one verified booking
 * (`src/lib/ready-snapshot.ts`). The worker fetches it when it keeps the page
 * and stores it in place of the page itself.
 */
export function readySnapshotPath(readyPath: string): string {
  return `${readyPath}/offline`;
}

/**
 * What the server hands the worker: the instants it calibrates expiry with, and
 * the three whole documents the worker may serve. It holds no token, link or
 * form, so the worker never edits a document: it only chooses one.
 */
export type ReadySnapshot = {
  /** Server clock when the snapshot was built (epoch ms). */
  generatedAt: number;
  /** When the copy stops being served (epoch ms): `readyCopyKeepUntil`. */
  keepUntil: number;
  /** Served while the device clock agrees with the one it was saved on. */
  saved: string;
  /** Served with a warning when no clock history exists to check the device clock against. */
  unverified: string;
  /** Served instead of the copy when the device clock has gone backward. */
  rollback: string;
  /**
   * One plain sentence the worker puts above `saved` or `unverified` when the
   * diver has since seen the page online and the copy could not be refreshed.
   * Text, never markup: the worker escapes it.
   */
  staleNotice: string;
};

/** The snapshot in `value`, or null when anything about its shape is off. */
export function parseReadySnapshot(value: unknown): ReadySnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const { generatedAt, keepUntil, saved, unverified, rollback, staleNotice } = value as Record<
    string,
    unknown
  >;
  if (
    !Number.isSafeInteger(generatedAt) ||
    (generatedAt as number) <= 0 ||
    !Number.isSafeInteger(keepUntil) ||
    typeof saved !== "string" ||
    typeof unverified !== "string" ||
    typeof rollback !== "string" ||
    typeof staleNotice !== "string"
  ) {
    return null;
  }
  return {
    generatedAt: generatedAt as number,
    keepUntil: keepUntil as number,
    saved,
    unverified,
    rollback,
    staleNotice,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant (epoch ms) the phone's copy of this page stops being served: a
 * day after the boat is due back, or, with no return time, a day after it
 * leaves. Only a live booking gets a snapshot to name one; a cancelled seat or a
 * departure called off gets none, which clears the copy.
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

/** The key of the one kept copy inside {@link READY_CACHE_NAME} (`src/worker/ready-page-cache.ts`). */
const READY_COPY_KEY = "/ready/kept-copy";

/** The header the worker stamps on the kept copy: a SHA-256 of the page path it was kept for. */
const READY_PATH_HASH_HEADER = "x-diveday-path-sha256";

/**
 * **A cancelled seat takes its copy with it** (issue #2979, security review
 * 2026-10-24, finding 1). A self-cancel is a server action, and a hydrated
 * page follows its redirect without a navigation the worker can see, so the
 * card the cancel lands on asks the worker controlling it to forget this
 * page's copy (by its own path: another booking's copy stays). Answers
 * whether this page's copy is gone; never throws.
 *
 * A worker that answers `ok: false` has already deleted this path's copy
 * (or has none to delete), so the page does nothing more. With no worker, or
 * one that does not answer in time, the page deletes only the cached entry
 * stamped with the hash of its own path, never the whole cache.
 */
export async function forgetThisReadyPage(): Promise<boolean> {
  try {
    const serviceWorker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    // A page the worker does not control yet (it was loaded before the claim)
    // still reaches the diver's registration, and the worker answers any
    // client by its own URL.
    let worker: ServiceWorker | null = serviceWorker?.controller ?? null;
    if (!worker) {
      try {
        worker = (await serviceWorker?.getRegistration(READY_WORKER_SCOPE))?.active ?? null;
      } catch {
        worker = null;
      }
    }
    const answer = worker ? await askWorkerToForget(worker) : null;
    if (answer === true) return true;
    if (answer === false) return false;
    // No worker, or one that did not answer in time: the page is the last
    // thing standing between a cancelled seat and its saved summary, so it
    // drops its own path's copy itself.
    return await dropThisPagesReadyCopy();
  } catch {
    return false;
  }
}

/** The worker's answer, or null when it gave none in time. */
function askWorkerToForget(worker: ServiceWorker): Promise<boolean | null> {
  return new Promise<boolean | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, ACTIVATE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.ok === true);
    };
    worker.postMessage({ type: "FORGET_READY_PAGE" }, [channel.port2]);
  });
}

async function pagePathHash(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Deletes the kept copy only when it was kept for this page's path. */
async function dropThisPagesReadyCopy(): Promise<boolean> {
  try {
    if (typeof caches === "undefined" || !caches || typeof location === "undefined") return false;
    const hash = await pagePathHash(location.pathname);
    const cache = await caches.open(READY_CACHE_NAME);
    const kept = await cache.match(READY_COPY_KEY);
    if (kept && kept.headers.get(READY_PATH_HASH_HEADER) === hash) {
      await cache.delete(READY_COPY_KEY);
    }
    return true;
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
  let registrationsRemoved = true;
  if (worker) {
    try {
      const registrations = await worker.getRegistrations();
      const removed = await Promise.all(
        registrations
          .filter((registration) => new URL(registration.scope).pathname === READY_WORKER_SCOPE)
          .map((registration) => registration.unregister().catch(() => false)),
      );
      registrationsRemoved = removed.every(Boolean);
    } catch {
      registrationsRemoved = false;
    }
  }
  try {
    if (typeof caches === "undefined" || !caches) return false;
    await caches.delete(READY_CACHE_NAME);
    // The forget markers too (#2979): they guard against a save landing
    // after a forget, and with this registration gone none can, so a shared
    // device keeps no hash of the link's path either.
    await caches.delete(READY_FORGOTTEN_CACHE_NAME);
    return registrationsRemoved;
  } catch {
    return false;
  }
}
