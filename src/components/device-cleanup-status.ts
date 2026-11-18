const INCOMPLETE_KEY = "diveday-device-cleanup-incomplete";

/** A generic, tab-local warning; it carries no identity or offline contents. */
export function markDeviceCleanupIncomplete(): void {
  try {
    sessionStorage.setItem(INCOMPLETE_KEY, "1");
  } catch {
    /* unavailable storage */
  }
}

export function deviceCleanupMayBeIncomplete(): boolean {
  try {
    return sessionStorage.getItem(INCOMPLETE_KEY) === "1";
  } catch {
    return true;
  }
}
