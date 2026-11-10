/** Device-only convenience, never evidence that a manifest is saved (ADR 20260907-in-your-hands). */
export const HOME_SCREEN_INSTALL_DISMISSED_KEY = "diveday:home-screen-install-dismissed";

export type InstallPlatform = "ios-safari" | "ios-other" | "android-chrome" | "android-other";

/** Only known phone/tablet platforms. A narrow desktop window is still a desktop. */
export function installPlatform(
  navigator: Pick<Navigator, "userAgent" | "maxTouchPoints">,
): InstallPlatform | null {
  const ua = navigator.userAgent;
  if (/; wv[;) ]|FBAN|FBAV|Instagram|Line\//i.test(ua)) return null;
  const ios =
    /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) {
    if (!/Version\/[\d.]+.*Safari\/|CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return null;
    return /Version\/[\d.]+.*Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
      ? "ios-safari"
      : "ios-other";
  }
  if (!/Android/i.test(ua)) return null;
  return /Chrome\//.test(ua) && !/EdgA|SamsungBrowser|OPR|Vivaldi/.test(ua)
    ? "android-chrome"
    : "android-other";
}

type PreferenceStorage = Pick<Storage, "getItem"> & Partial<Pick<Storage, "setItem">>;

/** A refused read suppresses the hint; a refused write still holds for this document's lifetime. */
export function createInstallPreference() {
  let dismissedInMemory = false;
  return {
    dismissed(storage: () => PreferenceStorage): boolean {
      if (dismissedInMemory) return true;
      try {
        return storage().getItem(HOME_SCREEN_INSTALL_DISMISSED_KEY) === "yes";
      } catch {
        return true;
      }
    },
    dismiss(storage: () => PreferenceStorage): void {
      dismissedInMemory = true;
      try {
        storage().setItem?.(HOME_SCREEN_INSTALL_DISMISSED_KEY, "yes");
      } catch {
        // No persistence is promised when the browser refuses storage.
      }
    },
  };
}

export const homeScreenInstallPreference = createInstallPreference();
