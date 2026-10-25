import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fromAddressFor } from "@/lib/notifications/shop-voice";
import { fileScopedShopContext } from "@/test/db";
import { sendNotification } from "./notifications";
import { shops } from "./schema";

/**
 * Issue #2450: a shop name held for review never reaches the From column. The
 * flag is read from the shop for every message in a shop's voice, including one
 * whose caller brought its own sender profile without it.
 */
const ctx = fileScopedShopContext();

function held(shopId: string, extra: Partial<Notification> = {}): Notification {
  return {
    kind: "seat_already_held",
    heldBookingId: "00000000-0000-4000-8000-0000000000b1",
    shopId,
    to: "holder@example.com",
    locale: "en-US",
    diverName: "Orla Organizer",
    shopName: "PayPal Security",
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

const FROM = "DiveDay <notifications@ses.dive.day>";

describe("a shop name held for review", () => {
  it("sends as plain DiveDay even when the caller's own sender profile lacks the flag", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ nameFlaggedAt: nowDate() }).where(eq(shops.id, shop.id));
    const { seen, provider } = recorder();
    await sendNotification(
      db,
      held(shop.id, { sender: { postalAddress: "1 Dock Rd, Key Largo, FL" } } as never),
      provider,
    );
    const sent = seen[0];
    if (!sent) throw new Error("expected a send");
    expect(fromAddressFor(FROM, sent)).toBe(FROM);
    // The caller's own lines survive; only the flag is added.
    expect("sender" in sent && sent.sender?.postalAddress).toBe("1 Dock Rd, Key Largo, FL");
  });

  it("sends a cleared or unflagged shop in its own voice", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ nameFlaggedAt: null }).where(eq(shops.id, shop.id));
    const { seen, provider } = recorder();
    await sendNotification(
      db,
      held(shop.id, { shopName: "Blue Mantis", sender: { postalAddress: "1 Dock Rd" } } as never),
      provider,
    );
    const sent = seen[0];
    if (!sent) throw new Error("expected a send");
    expect(fromAddressFor(FROM, sent)).toContain("Blue Mantis via DiveDay");
  });
});
