import { count, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { recordLostItem } from "@/db/lost-items";
import {
  divePackages,
  diveSites,
  executedDives,
  formDrafts,
  interests,
  lostItems,
  people,
  shopPromoCodes,
  shops,
  tripSightings,
  workOrders,
} from "@/db/schema";
import { getShopById } from "@/db/shops";
import { createTrip } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import type { ShopFeature } from "@/lib/shop-features";
import { SHOP_FEATURE_COLUMNS } from "@/lib/shop-features";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **A switched-off feature's actions write nothing** (the Features page).
 * Its pages redirect and its forms are gone, but a hand-built post still
 * reaches the action, so each one asks the switch before it writes. These run
 * the real actions as the owner, who passes every role gate, so the switch is
 * the only thing refusing.
 */

const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn(), requireShopSurface: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession, requireShopSurface } = await import("@/lib/session");
const { createWorkOrderAction } = await import("./gear/work-orders/actions");
const { resendReadyNoticeAction } = await import("./gear/work-orders/follow-up-actions");
const { createPromoAction } = await import("./promos/actions");
const { createDivePackageAction } = await import("./settings/package-actions");
const { lostItemRowAction } = await import("@/app/actions/lost-items");
const { recordSightingAction, deleteSightingAction, saveExecutedDiveAction } = await import(
  "./trips/[id]/manifest/actions"
);
const { addKnownDiverToWaitlistAction, invitePastDiverAction } = await import(
  "./trips/[id]/roster-seating-actions"
);
const { tookACallAction } = await import("./bookings/new/call-actions");

async function asOwnerWith(feature: ShopFeature) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  await db
    .update(shops)
    .set({ [SHOP_FEATURE_COLUMNS[feature]]: false })
    .where(eq(shops.id, shop.id));
  return { db, shop, owner };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("actions behind a switched-off feature", () => {
  it("opens no ticket and sends no ready message while gear servicing is off", async () => {
    const { db, shop } = await asOwnerWith("workOrders");
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id));
    if (!diver) throw new Error("seeded diver missing");
    const [before] = await db.select({ n: count() }).from(workOrders);

    expect(
      await redirectedTo(() =>
        createWorkOrderAction(form({ personId: diver.id, reportedProblem: "Free flows" })),
      ),
    ).toBe(`/shop/${shop.slug}/gear`);
    expect(
      await redirectedTo(() =>
        resendReadyNoticeAction(form({ workOrderId: "00000000-0000-4000-8000-000000000001" })),
      ),
    ).toBe(`/shop/${shop.slug}/gear`);

    const [after] = await db.select({ n: count() }).from(workOrders);
    expect(after?.n).toBe(before?.n);
  });

  it("mints no promo code while promo codes are off", async () => {
    const { db, shop } = await asOwnerWith("promoCodes");
    const to = await redirectedTo(() =>
      createPromoAction(form({ code: "HANDBUILT", description: "", discount: "10", scope: "all" })),
    );
    expect(to).toBe(`/shop/${shop.slug}/promos`);
    const made = await db
      .select({ id: shopPromoCodes.id })
      .from(shopPromoCodes)
      .where(eq(shopPromoCodes.code, "HANDBUILT"));
    expect(made).toEqual([]);
  });

  it("adds no package to the price list while dive packages are off", async () => {
    const { db, shop } = await asOwnerWith("divePackages");
    const to = await redirectedTo(() =>
      createDivePackageAction(
        form({ name: "Hand-built card", diveCount: "5", priceDollars: "100", scope: "all" }),
      ),
    );
    expect(to).toBe(`/shop/${shop.slug}/promos`);
    const made = await db
      .select({ id: divePackages.id })
      .from(divePackages)
      .where(eq(divePackages.name, "Hand-built card"));
    expect(made).toEqual([]);
  });

  it("changes no found item while lost and found is off, and keeps it", async () => {
    const { db, shop } = ctx;
    const startsAt = new Date(nowDate().getTime() - 6 * 3_600_000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Switched-off lost and found",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 8,
    });
    if (!trip) throw new Error("trip not created");
    const found = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "Blue mask",
      actorPersonId: null,
    });
    if (!found.ok) throw new Error(found.reason);
    await asOwnerWith("lostFound");

    const outcome = await lostItemRowAction(
      trip.id,
      undefined,
      form({ itemId: found.item.id, intent: "returned" }),
    );

    expect(outcome).toEqual({ status: "refused", reason: "not_found" });
    const [item] = await db
      .select({ status: lostItems.status })
      .from(lostItems)
      .where(eq(lostItems.id, found.item.id));
    expect(item?.status).toBe("open");
  });

  it("logs and takes back no sighting while sightings are off, and logs one once on", async () => {
    const { db, shop } = ctx;
    const startsAt = new Date(nowDate().getTime() - 6 * 3_600_000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Switched-off sightings",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 8,
    });
    if (!trip) throw new Error("trip not created");
    const [site] = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .limit(1);
    if (!site) throw new Error("seeded dive site missing");
    const { owner } = await asOwnerWith("sightings");
    const surface = async () => ({
      db,
      shop: await getShopById(db, shop.id),
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    });
    vi.mocked(requireShopSurface).mockImplementation((async () => surface()) as never);
    const sightingCtx = {
      shopSlug: shop.slug,
      tripId: trip.id,
      checkpoint: "after_dive_1" as const,
      diveSiteId: site.id,
    };
    const tap = form({ speciesSlug: "green-sea-turtle" });
    const logged = () =>
      db
        .select({ id: tripSightings.id })
        .from(tripSightings)
        .where(eq(tripSightings.tripId, trip.id));

    // Switched off is its own answer, not a lost connection: the group
    // refreshes and goes rather than asking for another tap.
    expect(await recordSightingAction(sightingCtx, undefined, tap)).toEqual({
      status: "switched_off",
    });
    expect(await deleteSightingAction(sightingCtx, undefined, tap)).toEqual({
      status: "switched_off",
    });
    expect(await logged()).toEqual([]);

    await db.update(shops).set({ sightingsEnabled: true }).where(eq(shops.id, shop.id));
    expect(await recordSightingAction(sightingCtx, undefined, tap)).toEqual({ status: "ok" });
    expect(await logged()).toHaveLength(1);
  });

  it("saves the species a form that drew the picker posted, after sightings went off", async () => {
    const { db, shop } = ctx;
    const startsAt = new Date(nowDate().getTime() - 6 * 3_600_000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Sightings off mid-save",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 8,
    });
    if (!trip) throw new Error("trip not created");
    const { owner } = await asOwnerWith("sightings");
    vi.mocked(requireShopSurface).mockImplementation((async () => ({
      db,
      shop: await getShopById(db, shop.id),
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    })) as never);
    const diveCtx = { shopSlug: shop.slug, tripId: trip.id, checkpoint: "after_dive_1" as const };
    const species = () =>
      db
        .select({ slug: executedDives.observedSpeciesSlug })
        .from(executedDives)
        .where(eq(executedDives.tripId, trip.id));
    const save = (fields: Record<string, string>) =>
      saveExecutedDiveAction(
        diveCtx,
        undefined,
        form({ diveNumber: "1", actualSiteId: "", maxDepthMeters: "", ...fields }),
      );

    // The form loaded with sightings on, so it drew the picker and its marker;
    // the switch went off before Save. What the crew picked is saved.
    expect(await save({ speciesShown: "1", observedSpeciesSlug: "green-sea-turtle" })).toEqual({
      status: "ok",
    });
    expect(await species()).toEqual([{ slug: "green-sea-turtle" }]);

    // A form drawn with sightings off posts no marker: the species stays.
    expect(await save({ maxDepthMeters: "18", observedSpeciesSlug: "" })).toEqual({
      status: "ok",
    });
    expect(await species()).toEqual([{ slug: "green-sea-turtle" }]);
  });

  it("puts nobody on a full boat's wait list, and invites no past diver, while those are off", async () => {
    const { db, shop } = ctx;
    const startsAt = new Date(nowDate().getTime() + 5 * 24 * 3_600_000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Switched-off asks",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      // Open seats: the seat answer comes before the switch (review item 7).
      capacity: 4,
    });
    if (!trip) throw new Error("trip not created");
    const { owner } = await asOwnerWith("waitlist");
    await db.update(shops).set({ pastDiverInvitesEnabled: false }).where(eq(shops.id, shop.id));
    vi.mocked(requireShopSurface).mockImplementation((async () => ({
      db,
      shop: await getShopById(db, shop.id),
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    })) as never);
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id));
    if (!diver) throw new Error("seeded diver missing");
    const asks = () => db.select().from(interests).where(eq(interests.tripId, trip.id));

    expect(
      await redirectedTo(() =>
        addKnownDiverToWaitlistAction(shop.slug, trip.id, form({ personId: diver.id })),
      ),
    ).toContain("notice=diver-waitlist-available");
    expect(
      await redirectedTo(() =>
        invitePastDiverAction(shop.slug, trip.id, form({ personId: diver.id })),
      ),
    ).toContain("notice=invite-unavailable");
    expect(await asks()).toEqual([]);
  });

  it("sends a wait-list call back to Add a booking with the caller's details kept", async () => {
    // Review 2026-10-23, item 6: the draft used to be discarded before the
    // wait list's writer refused, so the caller's details were gone.
    const { db, shop } = ctx;
    const startsAt = new Date(nowDate().getTime() + 6 * 24 * 3_600_000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Switched-off call",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 4,
    });
    if (!trip) throw new Error("trip not created");
    const { owner } = await asOwnerWith("waitlist");
    vi.mocked(requireShopSurface).mockImplementation((async () => ({
      db,
      shop: await getShopById(db, shop.id),
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    })) as never);

    const to = await redirectedTo(() =>
      tookACallAction(
        shop.slug,
        form({
          outcome: "waitlist",
          fullName: "Calla Caller",
          email: "calla@example.com",
          tripId: trip.id,
        }),
      ),
    );
    expect(to).toContain(`/shop/${shop.slug}/bookings/new`);
    expect(to).toContain("notice=call-waitlist-off");
    expect(to).toContain("outcome=date-request");
    const [draft] = await db
      .select({ fields: formDrafts.fields })
      .from(formDrafts)
      .where(eq(formDrafts.personId, owner));
    expect(draft?.fields).toMatchObject({ fullName: "Calla Caller", email: "calla@example.com" });
    expect(await db.select().from(interests).where(eq(interests.tripId, trip.id))).toEqual([]);
  });
});
