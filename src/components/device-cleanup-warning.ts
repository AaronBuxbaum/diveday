const INCOMPLETE_KEY = "diveday-offline-cleanup-incomplete";
export const DEVICE_CLEANUP_WARNING_EVENT = "diveday-offline-cleanup-warning";

/** A sticky, tenant-neutral warning for this tab. It is not evidence of erasure. */
export function markDeviceCleanupIncomplete(): void {
  try {
    window.sessionStorage.setItem(INCOMPLETE_KEY, "1");
  } catch {
    // Explicit sign-out also carries a generic flag in its redirect.
  } finally {
    try {
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event(DEVICE_CLEANUP_WARNING_EVENT));
    } catch {
      // The redirect flag still reports an incomplete explicit sign-out.
    }
  }
}

/** Storage failure leaves cleanup status unknown, not successful. */
export function deviceCleanupMayBeIncomplete(): boolean {
  try {
    return window.sessionStorage.getItem(INCOMPLETE_KEY) === "1";
  } catch {
    return true;
  }
}
