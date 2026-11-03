import { staffTranslator } from "@/i18n/staff-messages";

// i18n-exempt-file: the terminal renderer for the pushes a staff device shows
// (the manifest changed, a stale roll call, a missing diver), on the same
// footing as `./desk-notes.ts`: the service worker shows these words as they
// arrive, so they are resolved here, per device, in its owner's locale.
// `src/db/push-subscriptions.ts` and the alert passes decide who is pushed.

export type StaffPushWords = { title: string; body: string };

/** "The manifest changed": the saved copy refreshes, and these words show when no page is open. */
export function manifestChangedPush(locale: string): StaffPushWords {
  const t = staffTranslator(locale);
  return {
    title: t("trips.offlineManifestManager.pushNotificationTitle"),
    body: t("trips.offlineManifestManager.pushNotificationBody"),
  };
}

/** A roll call left open past its half hour: the counts in their own words, as the email says them. */
export function staleRollCallPush(
  locale: string,
  input: { title: string; dive: number; notBackAboard: number; awaiting: number },
): StaffPushWords {
  const t = staffTranslator(locale);
  const values = {
    title: input.title,
    dive: input.dive,
    missing: input.notBackAboard,
    awaiting: input.awaiting,
  };
  const body =
    input.notBackAboard > 0 && input.awaiting > 0
      ? t("manifest.staleRollCall.pushBodyBoth", values)
      : input.notBackAboard > 0
        ? t("manifest.staleRollCall.pushBodyMissing", values)
        : t("manifest.staleRollCall.pushBody", values);
  return { title: t("manifest.staleRollCall.pushTitle"), body };
}

/** A diver reported missing on a departure. */
export function missingDiverPush(locale: string, input: { title: string }): StaffPushWords {
  const t = staffTranslator(locale);
  return {
    title: t("manifest.missingDiverAlert.pushTitle"),
    body: t("manifest.missingDiverAlert.pushBody", { title: input.title }),
  };
}
