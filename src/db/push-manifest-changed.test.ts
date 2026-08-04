import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upcomingTripsWithCounts } from "@/db/trips";
import { seededShopContext } from "@/test/db";
import { people, pushSubscriptions } from "./schema";

// Mocked at the transport boundary: everything above it (claiming, coalescing,
// locale resolution, pruning) is the real code under test.
vi.mock("@/lib/notifications/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/web-push")>();
  return { ...actual, sendWebPush: vi.fn() };
});

const { sendWebPush } = await import("@/lib/notifications/web-push");
const { pushManifestChanged, savePushSubscription } = await import("./push-subscriptions");

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-a";

async function subscribed() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((candidate) => candidate.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("expected seeded trip missing");
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id));
  if (!person) throw new Error("expected a seeded person");
  await savePushSubscription(db, {
    shopId: shop.id,
    tripId: trip.id,
    personId: person.id,
    endpoint: ENDPOINT,
    p256dh: "p",
    auth: "a",
  });
  return { db, shop, trip };
}

beforeEach(() => {
  vi.mocked(sendWebPush).mockReset();
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("VAPID_SUBJECT", "mailto:ops@dive.day");
});

describe("pushManifestChanged", () => {
  it("sends nothing at all when VAPID keys are not configured", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    const { db, shop, trip } = await subscribed();
    await pushManifestChanged(db, shop.id, trip.id, trip.startsAt);
    // Push being unconfigured is a supported state, not an error: the SSE
    // stream and the interval still refresh the manifest.
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it("sends a translated, trip-scoped payload to a due subscriber", async () => {
    vi.mocked(sendWebPush).mockResolvedValue({ status: "sent" });
    const { db, shop, trip } = await subscribed();

    await pushManifestChanged(db, shop.id, trip.id, trip.startsAt);

    expect(sendWebPush).toHaveBeenCalledTimes(1);
    const [target, payload] = vi.mocked(sendWebPush).mock.calls[0] ?? [];
    expect(target).toMatchObject({ endpoint: ENDPOINT, p256dh: "p", auth: "a" });
    // The worker cannot reach a message bundle, so the words must arrive
    // already translated — and the URL must point at this trip's manifest.
    expect(payload).toMatchObject({
      kind: "manifest-changed",
      tripId: trip.id,
      url: `/shop/${shop.slug}/trips/${trip.id}/manifest`,
    });
    const words = payload as { title: string; body: string };
    expect(words.title.length).toBeGreaterThan(0);
    expect(words.body.length).toBeGreaterThan(0);
  });

  it("deletes a subscription the push service reports as gone", async () => {
    vi.mocked(sendWebPush).mockResolvedValue({ status: "gone" });
    const { db, shop, trip } = await subscribed();

    await pushManifestChanged(db, shop.id, trip.id, trip.startsAt);

    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.tripId, trip.id)),
    ).toHaveLength(0);
  });

  it("keeps a subscription that merely failed, so a bad minute is not an unsubscribe", async () => {
    vi.mocked(sendWebPush).mockResolvedValue({ status: "failed" });
    const { db, shop, trip } = await subscribed();

    await pushManifestChanged(db, shop.id, trip.id, trip.startsAt);

    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.tripId, trip.id)),
    ).toHaveLength(1);
  });

  it("never throws, even when the transport rejects outright", async () => {
    // The contract that matters most: this runs off the back of a roll-call
    // write, and must not be able to fail it.
    vi.mocked(sendWebPush).mockRejectedValue(new Error("transport exploded"));
    const { db, shop, trip } = await subscribed();

    await expect(pushManifestChanged(db, shop.id, trip.id, trip.startsAt)).resolves.toBeUndefined();
  });

  it("does not send twice for a burst of changes inside the coalescing window", async () => {
    vi.mocked(sendWebPush).mockResolvedValue({ status: "sent" });
    const { db, shop, trip } = await subscribed();

    await pushManifestChanged(db, shop.id, trip.id, trip.startsAt);
    await pushManifestChanged(db, shop.id, trip.id, trip.startsAt);
    await pushManifestChanged(db, shop.id, trip.id, trip.startsAt);

    expect(sendWebPush).toHaveBeenCalledTimes(1);
  });
});
