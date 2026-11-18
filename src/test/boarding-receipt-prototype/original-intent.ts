import type { OfflineRollCallEvent } from "@/lib/offline-manifests";

/**
 * Experimental provenance capture. This is not an authorization check, a
 * durable queue, or a production input. Legacy events do not carry a signed
 * meeting generation or original actor, so neither may be inferred here. The
 * shop slug is an unverified caller assertion; a day is only a stored index.
 * The cloned event includes mutable delivery fields and is not canonical.
 */
export function captureOriginalRollCallIntent(shopSlug: string, event: OfflineRollCallEvent) {
  const captured = structuredClone(event);
  const booking = typeof captured.bookingId === "string" && captured.bookingId.length > 0;
  const crew = typeof captured.crewPersonId === "string" && captured.crewPersonId.length > 0;
  const subject =
    booking && captured.crewPersonId === undefined
      ? { kind: "booking" as const, id: captured.bookingId }
      : crew && captured.bookingId === undefined
        ? { kind: "crew" as const, id: captured.crewPersonId }
        : { kind: "unknown" as const };
  const day = captured.meetingDay;
  return {
    assertedShopSlug: shopSlug,
    event: captured,
    subject,
    meetingDay:
      typeof day === "number" && Number.isSafeInteger(day) && day >= 0
        ? { kind: "captured" as const, day }
        : { kind: "unknown" as const },
    meetingGeneration: { kind: "unknown" as const },
    actor: { kind: "unknown" as const },
  };
}
