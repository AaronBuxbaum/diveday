import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookingCheckouts,
  bookings,
  integrationDeliveries,
  shopIntegrations,
  shops,
  tips,
} from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  demoteOwnerToManager,
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const fileCtx = fileScopedShopContext();

/**
 * "Send earlier checkouts" (issue #2606), run for real against a seeded
 * database with the session and Next's `redirect` faked: the owner gate read
 * from live roles, the day read in the shop's zone, and the integration
 * resolved inside the shop before anything is queued.
 */

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
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { sendEarlierCheckoutsAction } = await import("./actions");

const PATH = "/shop/blue-mantis/settings/integrations";

async function context() {
  const { db, shop } = fileCtx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  const signIn = (personId: string) =>
    vi
      .mocked(requireStaffSession)
      .mockResolvedValue(
        staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["owner"] }) as never,
      );
  const [integration] = await db
    .insert(shopIntegrations)
    .values({
      shopId: shop.id,
      provider: "zapier",
      credentialsSealed: "sealed",
      settings: { eventTypes: ["order.paid", "order.refunded"] },
    })
    .returning();
  if (!integration) throw new Error("integration insert failed");
  // One paid tip yesterday, the only thing the run has to send.
  const [booking] = await db.select().from(bookings).where(eq(bookings.shopId, shop.id)).limit(1);
  if (!booking) throw new Error("seeded booking missing");
  // The demo data has checkouts and tips of its own; push them out of the window.
  await db.update(tips).set({ completedAt: new Date(0) });
  await db.update(bookingCheckouts).set({ completedAt: new Date(0) });
  await db.insert(tips).values({
    shopId: shop.id,
    bookingId: booking.id,
    status: "paid",
    stripeAccountId: "acct_x",
    stripeSessionId: "cs_tip_earlier",
    currency: "usd",
    amountCents: 1_500,
    completedAt: new Date(nowDate().getTime() - 86_400_000),
  });
  return { db, shop, owner, captain, signIn, integration };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const WEEK_AGO = () => new Date(nowDate().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);

async function deliveries() {
  return fileCtx.db.select().from(integrationDeliveries);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendEarlierCheckoutsAction", () => {
  it("queues the unsent events for the owner, and says how many", async () => {
    const { owner, signIn, integration } = await context();
    signIn(owner);
    const to = await redirectedTo(() =>
      sendEarlierCheckoutsAction(form({ integrationId: integration.id, since: WEEK_AGO() })),
    );
    expect(to).toBe(`${PATH}?notice=earlier-sent&count=1`);
    expect(await deliveries()).toHaveLength(1);
  });

  it("sends nothing the second time", async () => {
    const { owner, signIn, integration } = await context();
    signIn(owner);
    const data = () => form({ integrationId: integration.id, since: WEEK_AGO() });
    await redirectedTo(() => sendEarlierCheckoutsAction(data()));
    const again = await redirectedTo(() => sendEarlierCheckoutsAction(data()));
    expect(again).toBe(`${PATH}?notice=earlier-none&count=0`);
    expect(await deliveries()).toHaveLength(1);
  });

  it("refuses a manager whose session claims owner, and queues nothing", async () => {
    const { db, owner, signIn, integration } = await context();
    await demoteOwnerToManager(db, owner);
    signIn(owner);
    const to = await redirectedTo(() =>
      sendEarlierCheckoutsAction(form({ integrationId: integration.id, since: WEEK_AGO() })),
    );
    expect(to).toBe(`${PATH}?notice=earlier-not-owner`);
    expect(await deliveries()).toHaveLength(0);
  });

  it("refuses a captain at the settings door, and queues nothing", async () => {
    const { captain, signIn, integration } = await context();
    signIn(captain);
    const to = await redirectedTo(() =>
      sendEarlierCheckoutsAction(form({ integrationId: integration.id, since: WEEK_AGO() })),
    );
    expect(to).toBe("/shop/blue-mantis?notice=integrations-not-authorized");
    expect(await deliveries()).toHaveLength(0);
  });

  it("refuses a day that is not on the calendar, and one that is not a day", async () => {
    const { owner, signIn, integration } = await context();
    signIn(owner);
    for (const since of ["2026-02-31", "yesterday", ""]) {
      const to = await redirectedTo(() =>
        sendEarlierCheckoutsAction(form({ integrationId: integration.id, since })),
      );
      expect(to).toBe(`${PATH}?notice=earlier-invalid`);
    }
    expect(await deliveries()).toHaveLength(0);
  });

  it("refuses an integration that belongs to another shop", async () => {
    const { db, owner, signIn } = await context();
    signIn(owner);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-earlier", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const [theirs] = await db
      .insert(shopIntegrations)
      .values({
        shopId: other.id,
        provider: "zapier",
        credentialsSealed: "sealed",
        settings: { eventTypes: ["order.paid"] },
      })
      .returning();
    if (!theirs) throw new Error("integration insert failed");
    const to = await redirectedTo(() =>
      sendEarlierCheckoutsAction(form({ integrationId: theirs.id, since: WEEK_AGO() })),
    );
    expect(to).toBe(`${PATH}?notice=earlier-invalid`);
    expect(await deliveries()).toHaveLength(0);
  });
});
