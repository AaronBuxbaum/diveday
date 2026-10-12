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
