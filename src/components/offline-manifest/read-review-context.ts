import type { OfflineManifestPayload, OfflineRollCallEvent } from "@/lib/offline-manifests";

type Tenant = { shopSlug: string; round: number };

/** Fetch identity and current roster only while the same verified tenant remains active. */
export async function readReviewContext(
  event: OfflineRollCallEvent,
  tenant: Tenant,
  reviewTenant: () => Promise<Tenant | null>,
  onIdentity: (name: string | null, sameAssignment: boolean) => void,
): Promise<OfflineManifestPayload> {
  const stillCurrent = async () => {
    const current = await reviewTenant();
    if (!current || current.shopSlug !== tenant.shopSlug || current.round !== tenant.round)
      throw new Error("tenant changed");
  };
  if (event.bookingId && event.rollCallWitness && event.meetingDay !== undefined) {
    const identity = await fetch("/api/offline-manifests/review/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId: event.tripId,
        bookingId: event.bookingId,
        snapshotId: event.snapshotId,
        checkpoint: event.checkpoint,
        meetingDay: event.meetingDay,
        witness: event.rollCallWitness,
      }),
    });
    if (!identity.ok) throw new Error("identity unavailable");
    const result: unknown = await identity.json();
    await stillCurrent();
    const value = result && typeof result === "object" ? result : {};
    onIdentity(
      "name" in value && typeof value.name === "string" ? value.name : null,
      "sameAssignment" in value && value.sameAssignment === true,
    );
  }
  const response = await fetch(
    `/api/offline-manifests/review?tripId=${encodeURIComponent(event.tripId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("review unavailable");
  const body = (await response.json()) as { current?: OfflineManifestPayload };
  await stillCurrent();
  if (!body.current || body.current.shop.slug !== tenant.shopSlug)
    throw new Error("tenant changed");
  return body.current;
}
