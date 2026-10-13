import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, preDepartureChecklistItems, tripStageEvents, trips } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

/**
 * **A form posted with another shop's slug bound into it**, for each of the
 * six action files that bind one (the manifest binds it inside a context object).
 *
 * Every write these actions make is scoped by `session.user.shopId`, so no
 * other tenant's row was ever at risk. The slug steered the rest: the
 * `revalidatePath` calls (another shop's board, Today and public course page)
 * and the redirect back with a notice. They now open with
 * `requireShopSurface(shopSlug)`, which is a 404 for a slug that is not the
 * session's shop, and `scripts/check-slug-actions.mjs` keeps a slug-bound
 * action from going back to `requireStaffSession`.
 *
 * The real gate runs here, behind a mocked `auth()`, against the seeded shop:
 * the folders' own tests mock `@/lib/session` and so cannot see the slug check.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { revalidatePath } = await import("next/cache");
const { pullCourseTemplateUpdatesAction } = await import("./courses/[slug]/edit/actions");
const { callBlowoutAction } = await import("./schedule/blowout/[tripId]/actions");
const { removeDepartureAction } = await import("./schedule/board/actions");
const { checkInAction } = await import("./trips/[id]/_arrivals/actions");
const { setTripStageAction } = await import("./trips/[id]/manifest/actions");
const { addChecklistItemAction } = await import("./settings/safety-checklist/actions");

const ctx = fileScopedShopContext();
const FOREIGN = "another-shop";

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  const owner = await seededStaffPersonId(ctx.db, ctx.shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(auth).mockResolvedValue(
    staffSession({ shopId: ctx.shop.id, shopSlug: ctx.shop.slug, personId: owner }) as never,
  );
});

async function aLiveTrip() {
  const [trip] = await ctx.db
    .select({ id: trips.id, status: trips.status })
    .from(trips)
    .where(and(eq(trips.shopId, ctx.shop.id), isNull(trips.deletedAt)))
    .limit(1);
  if (!trip) throw new Error("seeded shop has no live trip");
  return trip;
}

async function liveChecklistCount() {
  const rows = await ctx.db
    .select({ id: preDepartureChecklistItems.id })
    .from(preDepartureChecklistItems)
    .where(
      and(
        eq(preDepartureChecklistItems.shopId, ctx.shop.id),
        isNull(preDepartureChecklistItems.deletedAt),
      ),
    );
  return rows.length;
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("a form posted with another shop's slug bound into it", () => {
  it("course editor: pulling a template update is a 404 and revalidates nothing", async () => {
    await expect(
      pullCourseTemplateUpdatesAction(FOREIGN, "open-water-diver", "preserve-shop-edits", form({})),
    ).rejects.toThrow("NOT_FOUND");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("blow-out: calling one is a 404 and the trip stays as it was", async () => {
    const trip = await aLiveTrip();
    await expect(callBlowoutAction(FOREIGN, trip.id)).rejects.toThrow("NOT_FOUND");
    expect((await aLiveTrip()).status).toBe(trip.status);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("schedule board: removing a departure is a 404 and the departure stays", async () => {
    const trip = await aLiveTrip();
    await expect(removeDepartureAction(FOREIGN, form({ tripId: trip.id }))).rejects.toThrow(
      "NOT_FOUND",
    );
    const [after] = await ctx.db
      .select({ deletedAt: trips.deletedAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(after?.deletedAt).toBeNull();
  });

  it("arrivals counter: checking a diver in is a 404 and the booking is untouched", async () => {
    const [booking] = await ctx.db
      .select({ id: bookings.id, tripId: bookings.tripId, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.shopId, ctx.shop.id))
      .limit(1);
    if (!booking) throw new Error("seeded shop has no booking");
    await expect(
      checkInAction(FOREIGN, booking.tripId, form({ bookingId: booking.id })),
    ).rejects.toThrow("NOT_FOUND");
    const [after] = await ctx.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(after?.status).toBe(booking.status);
  });

  it("manifest: a stage posted with the slug inside its bound context is a 404 and records nothing", async () => {
    const trip = await aLiveTrip();
    const stages = () =>
      ctx.db
        .select({ id: tripStageEvents.id })
        .from(tripStageEvents)
        .where(eq(tripStageEvents.tripId, trip.id));
    const before = (await stages()).length;
    await expect(
      setTripStageAction(
        { shopSlug: FOREIGN, tripId: trip.id },
        { ok: false, reason: "error" },
        form({ stage: "boarding" }),
      ),
    ).rejects.toThrow("NOT_FOUND");
    expect((await stages()).length).toBe(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("safety checklist: adding an item is a 404 and adds nothing", async () => {
    const before = await liveChecklistCount();
    await expect(addChecklistItemAction(FOREIGN, form({ label: "Foreign item" }))).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(await liveChecklistCount()).toBe(before);
  });

  it("safety checklist, the control: the shop's own slug adds the item", async () => {
    // Without this, a gate that refused *everyone* would pass the cases above.
    const before = await liveChecklistCount();
    await expect(
      addChecklistItemAction(ctx.shop.slug, form({ label: "Own-shop item" })),
    ).rejects.toThrow(/REDIRECT:.*checklist-item-added/);
    expect(await liveChecklistCount()).toBe(before + 1);
  });
});
