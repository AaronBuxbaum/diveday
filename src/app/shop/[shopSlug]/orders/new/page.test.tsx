import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import type { DiveDaySession } from "@/lib/auth";
import { seededTestDb } from "@/test/db";
import { hiddenInputNamesIn } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";

// Same mocking shape as ../page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the three things that only exist inside one
// (the db handle, better-auth, and request headers) are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const NewOrderPage = (await import("./page")).default;

const SHOP_SLUG = "blue-mantis";

/**
 * The seeded shop with a charges-enabled Connect account, mocked in, plus one
 * real booking id. Without the account the page redirects before it reads
 * anything, which would make every assertion below vacuous.
 */
async function shopThatCanBill() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const owner = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("the seed has no owner");
  const account = await upsertShopStripeAccount(db, shop.id, "acct_unit_test");
  await setShopStripeAccountStatus(db, account.stripeAccountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!booking) throw new Error("the seed has no bookings");
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: SHOP_SLUG,
      name: owner.fullName,
      email: "staff@demo.invalid",
      roles: owner.roles,
    },
  });
  return { bookingId: booking.id };
}

function renderWith(searchParams: Record<string, string> = {}) {
  return NewOrderPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve(searchParams),
  });
}

/*
 * `?bookingId=` and `?personId=` arrive from links other pages build — a diver
 * record, a roster row — and a link is exactly the thing that gets truncated in
 * a chat message. `bookings.id` is a `uuid` column, so an unguarded stray value
 * is not an empty prefill but `invalid input syntax for type uuid`, a 500 on
 * the page a staffer only mistyped their way onto
 * (FU-20260814-orders-stray-person-id-500's sweep).
 */
describe("the prefill ids", () => {
  it("fills the form from a real booking", async () => {
    const { bookingId } = await shopThatCanBill();
    // The booking rides the form as a hidden field, which is the visible proof
    // the lookup ran — so the malformed case below is an observable difference
    // rather than "nothing happened either way".
    expect(hiddenInputNamesIn(await renderWith({ bookingId }))).toContain("bookingId");
  });

  it("treats a malformed booking id as no prefill at all", async () => {
    await shopThatCanBill();
    // The blank order form a staffer can still use — never a thrown query.
    expect(hiddenInputNamesIn(await renderWith({ bookingId: "nope" }))).not.toContain("bookingId");
  });
});
