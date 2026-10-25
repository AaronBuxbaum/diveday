import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/send-actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/send-actor")>()),
  currentSendActor: vi.fn(),
}));

const { currentSendActor } = await import("@/lib/notifications/send-actor");
const { nowDate } = await import("@/lib/clock");
const { fileScopedShopContext } = await import("@/test/db");
const { sendNotification, sendNotificationBatch } = await import("./notifications");

import type { Notification, NotificationProvider } from "@/lib/notifications";

/**
 * Who sent a message rides on `sender.sentByPersonId` to the SES tag, so a
 * bounce names the staff member whose action sent it. It must never cost the
 * send its shop's own sender profile.
 */
const ctx = fileScopedShopContext();

const STAFF = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function held(shopId: string, extra: Partial<Notification> = {}): Notification {
  return {
    kind: "seat_already_held",
    heldBookingId: "00000000-0000-4000-8000-0000000000b1",
    shopId,
    to: "holder@example.com",
    locale: "en-US",
    diverName: "Orla Organizer",
    shopName: "Blue Mantis",
    tripTitle: "Two-Tank Reef",
    startsAt: new Date("2026-10-20T14:00:00Z"),
    timezone: "America/New_York",
    requestedAt: nowDate(),
    attempt: "claim",
    ...extra,
  } as Notification;
}

function recorder() {
  const seen: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      seen.push(notification);
      return { status: "sent", providerMessageId: "m" };
    },
  };
  return { seen, provider };
}

beforeEach(() => {
  vi.mocked(currentSendActor).mockReset().mockResolvedValue(null);
});

describe("the staff member who sent it", () => {
  it("is stamped from the session, beside the shop's own sender profile", async () => {
    const { db, shop } = ctx;
    vi.mocked(currentSendActor).mockResolvedValue({ personId: STAFF, shopId: shop.id });
    const { seen, provider } = recorder();
    await sendNotification(db, held(shop.id), provider);
    const sent = seen[0];
    expect(sent?.sender?.sentByPersonId).toBe(STAFF);
    // The profile was still read from the shop, not skipped for the stamp.
    const { sentByPersonId: _, ...profile } = sent?.sender ?? {};
    const { seen: unstamped, provider: plain } = recorder();
    vi.mocked(currentSendActor).mockResolvedValue(null);
    await sendNotification(db, held(shop.id), plain);
    expect(profile).toEqual(unstamped[0]?.sender ?? {});
  });

  it("keeps a sender the notification already names over the session's", async () => {
    const { db, shop } = ctx;
    vi.mocked(currentSendActor).mockResolvedValue({
      personId: "00000000-0000-4000-8000-000000000001",
      shopId: shop.id,
    });
    const { seen, provider } = recorder();
    await sendNotification(db, held(shop.id, { sender: { sentByPersonId: STAFF } }), provider);
    expect(seen[0]?.sender?.sentByPersonId).toBe(STAFF);
  });

  it("is absent on a send no staff session made", async () => {
    const { db, shop } = ctx;
    const { seen, provider } = recorder();
    await sendNotification(db, held(shop.id), provider);
    expect(seen[0]?.sender?.sentByPersonId).toBeUndefined();
  });

  it("is read once for a fan-out and stamped on every member", async () => {
    const { db, shop } = ctx;
    vi.mocked(currentSendActor).mockResolvedValue({ personId: STAFF, shopId: shop.id });
    const { seen, provider } = recorder();
    await sendNotificationBatch(db, [held(shop.id), held(shop.id)], provider);
    expect(seen.map((sent) => sent.sender?.sentByPersonId)).toEqual([STAFF, STAFF]);
    expect(currentSendActor).toHaveBeenCalledTimes(1);
  });

  it("is absent when a staffer from another shop sends this shop's mail, booking as a diver", async () => {
    const { db, shop } = ctx;
    vi.mocked(currentSendActor).mockResolvedValue({
      personId: STAFF,
      shopId: "00000000-0000-4000-8000-0000000000ff",
    });
    const { seen, provider } = recorder();
    await sendNotification(db, held(shop.id), provider);
    expect(seen[0]?.sender?.sentByPersonId).toBeUndefined();
  });
});
