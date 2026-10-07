import { getDb } from "@/db/client";
import { markSetupRequestNotified } from "@/db/funnel";
import type { SetupRequest } from "@/db/schema";
import { trackEvent } from "@/lib/analytics";
import { eventSource } from "@/lib/funnel";
import { notify } from "@/lib/notifications";
import { ONBOARDING_EMAIL } from "@/lib/platform-mail";
import { SETUP_CURRENT_SYSTEMS, type SetupCurrentSystem } from "@/lib/setup-requests";

/**
 * What happens after a set-up request is stored: the `setup_requested` event,
 * and the mail to the onboarding inbox (ADR 20261007-setup-request-form).
 *
 * **No `"use server"` here, and there must never be one** — the same reason
 * `src/app/actions/demo-instrumentation.ts` sits beside its action: every
 * exported function of a `"use server"` module is a public endpoint, and this
 * one takes a whole row, so exported from the action's module it would let
 * anyone mail the onboarding inbox whatever they liked with no row behind it.
 * As a plain module it is reachable only from the action that stored the row.
 *
 * **Every failure is swallowed**, each observer on its own: it runs in
 * `after()`, the reader is already on the thank-you page, and the row is the
 * durable copy. A mail that did not leave keeps `notified_at` null, which the
 * founder digest counts.
 */
export async function announceSetupRequest(request: SetupRequest): Promise<void> {
  try {
    // The row's source is already clamped; clamped again so a type that came
    // off the database can never widen what the event vocabulary accepts.
    await trackEvent({ name: "setup_requested", source: eventSource(request.source) });
  } catch (error) {
    console.error("announceSetupRequest: setup_requested event failed", error);
  }

  try {
    const delivery = await notify({
      kind: "setup_request_alert",
      setupRequestId: request.id,
      to: ONBOARDING_EMAIL,
      shopName: request.shopName,
      region: request.region,
      runsBoat: request.runsBoat,
      currentSystem: currentSystemOf(request.currentSystem),
      contactName: request.contactName,
      contactEmail: request.email,
      contactPhone: request.phone ?? undefined,
      source: request.source,
      requestLocale: request.locale,
      // Reply goes straight to the shop that asked.
      sender: { replyTo: request.email },
    });
    if (delivery.status === "sent") await markSetupRequestNotified(await getDb(), request.id);
  } catch (error) {
    console.error("announceSetupRequest: onboarding mail failed", error);
  }
}

function currentSystemOf(value: string): SetupCurrentSystem {
  return (SETUP_CURRENT_SYSTEMS as readonly string[]).includes(value)
    ? (value as SetupCurrentSystem)
    : "other";
}
