import type { Page } from "@playwright/test";

export const INSTALL_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";
export const INSTALL_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
export const INSTALL_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

/** Deterministic browser capability, not an assertion that Chromium installs on the test host. */
export async function offerNativeInstall(
  page: Page,
  outcome: "accepted" | "dismissed" = "accepted",
) {
  return page.evaluate((choice) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        document.documentElement.dataset.installCalls = String(
          Number(document.documentElement.dataset.installCalls ?? 0) + 1,
        );
      },
      userChoice: Promise.resolve({ outcome: choice }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, outcome);
}
