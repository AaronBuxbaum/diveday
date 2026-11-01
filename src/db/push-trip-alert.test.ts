import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { fileScopedShopContext } from "@/test/db";
import { personRoles, pushSubscriptions, userAccounts } from "./schema";
import { listShopStaff, setStaffAccountStatus } from "./staff-accounts";
import { upcomingTripsWithCounts } from "./trips";

// Mocked at the transport boundary: who is chosen, and the words, are the
// real code under test.
vi.mock("@/lib/notifications/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/web-push")>();
  return { ...actual, sendWebPush: vi.fn() };
});

const { sendWebPush } = await import("@/lib/notifications/web-push");
const { pushTripAlert, savePushSubscription } = await import("./push-subscriptions");

const ctx = fileScopedShopContext();
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/staffer-device";
const words = () => ({ title: "Roll call still open", body: "Two-Tank Reef" });

/** An active, non-owner staffer following a seeded departure's manifest. */
async function following() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  const staffer = (await listShopStaff(db, shop.id)).find(
    (member) => member.accountStatus === "active" && !member.roles.includes("owner"),
  );
  if (!trip || !staffer) throw new Error("expected a seeded trip and staffer");
  await savePushSubscription(db, {
    shopId: shop.id,
    tripId: trip.id,
    personId: staffer.personId,
    endpoint: ENDPOINT,
    p256dh: "p",
    auth: "a",
  });
  const push = () => pushTripAlert(db, shop.id, trip.id, { url: "/x", words });
  return { db, shop, trip, staffer, push };
}

beforeEach(() => {
  vi.mocked(sendWebPush).mockReset();
  vi.mocked(sendWebPush).mockResolvedValue({ status: "sent" });
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("VAPID_SUBJECT", "mailto:ops@dive.day");
});

/**
 * Security review 20261014: the stale-roll-call push says a boat has somebody
 * unaccounted for. It reaches staff who still are, never a device left behind
 * by a disabled login or a demotion.
 */
describe("pushTripAlert's recipients", () => {
  it("pushes an active staffer following the manifest", async () => {
    const { push } = await following();
    expect(await push()).toBe(1);
  });

  it("skips a follower whose login was disabled, even with the row left behind", async () => {
    const { db, staffer, push } = await following();
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.id, staffer.userAccountId));
    expect(await push()).toBe(0);
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it("skips a follower who no longer holds a staff role", async () => {
    const { db, staffer, push } = await following();
    for (const role of STAFF_ROLES) {
      await db
        .delete(personRoles)
        .where(and(eq(personRoles.personId, staffer.personId), eq(personRoles.role, role)));
    }
    expect(await push()).toBe(0);
  });
});

describe("pushTripAlert delivery outcomes", () => {
  it("deletes a subscription the push service reports as gone", async () => {
    vi.mocked(sendWebPush).mockResolvedValue({ status: "gone" });
    const { db, staffer, push } = await following();

    expect(await push()).toBe(0);
    expect(
      await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, staffer.personId)),
    ).toEqual([]);
  });

  it("keeps a subscription that merely failed", async () => {
    vi.mocked(sendWebPush).mockResolvedValue({ status: "failed" });
    const { db, staffer, push } = await following();

    expect(await push()).toBe(0);
    expect(
      await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, staffer.personId)),
    ).toHaveLength(1);
  });

  it("returns zero when the transport rejects", async () => {
    vi.mocked(sendWebPush).mockRejectedValue(new Error("transport exploded"));
    const { push } = await following();

    await expect(push()).resolves.toBe(0);
  });
});

describe("setStaffAccountStatus", () => {
  it("drops a disabled staffer's manifest subscriptions", async () => {
    const { db, shop, staffer } = await following();
    expect(
      await setStaffAccountStatus(db, {
        shopId: shop.id,
        personId: staffer.personId,
        userAccountId: staffer.userAccountId,
        status: "disabled",
      }),
    ).toEqual({ ok: true });
    const left = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.personId, staffer.personId));
    expect(left).toEqual([]);
  });
});
