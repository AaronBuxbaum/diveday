import { and, eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "@/components/ui/badge";
import type { AppDb } from "@/db/client";
import {
  bookings,
  importedPaymentHistory,
  orders,
  paymentOperationIntents,
  people,
  trips,
} from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededTestDb } from "@/test/db";
import { ariaLabelsIn, findElements, hiddenInputNamesIn, hrefsIn } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { demoteOwnerToManager } from "@/test/staff-session";

// Same mocking shape as ../settings/SettingsPage.test.tsx: the page is invoked
// directly, outside Next's request scope, so the three things that only exist
// inside one (the db handle, next-auth, and request headers) are stubbed and
// nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const OrdersIndexPage = (await import("./page")).default;

const SHOP_SLUG = "blue-mantis";

/** A session for the seeded staff member who really holds `role`, roles and all. */
async function sessionFor(role: Role): Promise<{ db: AppDb; session: Session }> {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const member = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes(role));
  if (!member) throw new Error(`the seed has no ${role}`);
  return {
    db,
    session: {
      user: {
        personId: member.personId,
        shopId: shop.id,
        shopSlug: SHOP_SLUG,
        name: member.fullName,
        roles: member.roles,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

/** The page, rendered for whatever `?…` a test wants to put to it. */
function renderWith(searchParams: Record<string, string> = {}) {
  return OrdersIndexPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve(searchParams),
  });
}

async function renderOrders(role: Role, seed?: (db: AppDb, session: Session) => Promise<void>) {
  const { db, session } = await sessionFor(role);
  if (seed) await seed(db, session);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  return renderWith();
}

/**
 * An intent that started long enough ago to count as never having resolved.
 * Anchored to `nowDate()`, not the wall clock: the unit-test harness freezes
 * `DIVEDAY_CLOCK`, and `listStuckPaymentOperations` measures staleness against
 * that frozen instant — a real `Date.now()` here is a full fortnight in its
 * future and reads as an operation that started moments ago.
 */
async function stickAnOperation(db: AppDb, session: Session) {
  await db.insert(paymentOperationIntents).values({
    shopId: session.user.shopId,
    kind: "invoice",
    status: "started",
    stripeObjectId: "in_stuck",
    startedAt: new Date(nowDate().getTime() - 60 * 60 * 1000),
  });
}

/*
 * The stuck-payment-operations panel, which moved here from the monthly report:
 * reconciling an unconfirmed Stripe call is order work, not a report. What is
 * worth pinning down is the rendering condition and the gate that came with it.
 */
const PANEL = "Payments that need a check";

describe("the stuck-payment-operations panel", () => {
  it("renders nothing when there is nothing to reconcile", async () => {
    // The calm state: an empty queue is nothing on screen, not an empty table.
    // (The seed's one intent is `succeeded`, so this is the ordinary case.)
    expect(ariaLabelsIn(await renderOrders("owner"))).not.toContain(PANEL);
  });

  it("shows an unconfirmed operation to an owner", async () => {
    expect(ariaLabelsIn(await renderOrders("owner", stickAnOperation))).toContain(PANEL);
  });

  it("shows it to a manager too — the same role set the reports gate had", async () => {
    // The panel left `canPersonViewShopReports` for
    // `canPersonManagePaymentSettings`. Both are `isOwnerOrManager`, so the
    // move must not have cost a manager the visibility they already had. The
    // seed's only manager is also the owner (`src/db/seed-cast.ts`), so the
    // owner role is dropped first — the gate is DB-checked, so the demotion is
    // what the page sees.
    const element = await renderOrders("manager", async (db, session) => {
      await demoteOwnerToManager(db, session.user.personId);
      await stickAnOperation(db, session);
    });
    expect(ariaLabelsIn(element)).toContain(PANEL);
  });

  it("hides it from a divemaster, who can read orders but not reconcile them", async () => {
    // Reading the orders index stays open to every staff role — this panel does
    // not, which is the one thing that could have gone wrong in moving a
    // gated section onto an ungated page.
    expect(ariaLabelsIn(await renderOrders("divemaster", stickAnOperation))).not.toContain(PANEL);
  });
});

describe("imported payment history", () => {
  const PANEL = "Imported payment history";

  async function addImportedHistory(db: AppDb, session: Session) {
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, session.user.shopId))
      .limit(1);
    if (!person) throw new Error("seeded shop has no diver");
    const [history] = await db
      .insert(importedPaymentHistory)
      .values({
        shopId: session.user.shopId,
        personId: person.id,
        occurredOn: "2024-05-11",
        direction: "payment",
        title: "Prior-shop reef sale",
        statusLabel: "Settled",
        amountLabel: "$165.00",
        amountCents: 16_500,
        currency: "usd",
        receiptReference: "receipt_42",
        receiptDocumentUrl: "/import-receipts/receipt_42.pdf",
        sourceLabel: "Coral Coast Divers",
        stripeReference: "in_42",
        dedupeKey: "order-page-source-row",
        importedAt: nowDate(),
      })
      .returning({ id: importedPaymentHistory.id });
    if (!history) throw new Error("failed to insert imported source history");
    return { personId: person.id, historyId: history.id };
  }

  it("renders imported source records in their own clearly unverified Orders section", async () => {
    const { db, session } = await sessionFor("owner");
    const source = await addImportedHistory(db, session);
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(session);
    const element = await renderWith();

    expect(ariaLabelsIn(element)).toContain(PANEL);
    expect(hrefsIn(element)).toContain(`/shop/${SHOP_SLUG}/divers/${source.personId}`);
    expect(hrefsIn(element)).toContain("/import-receipts/receipt_42.pdf");
    // An imported row never receives an order detail link just because it is
    // rendered under Orders — its uuid must not be confused for an order id.
    expect(hrefsIn(element)).not.toContain(`/shop/${SHOP_SLUG}/orders/${source.historyId}`);
    expect(
      findElements<{ children?: unknown }>(element, Badge).some(
        (badge) => badge.props.children === "Unverified import",
      ),
    ).toBe(true);
  });

  it("does not render an unsafe raw receipt URL if legacy data bypassed the importer", async () => {
    const element = await renderOrders("owner", async (db, session) => {
      const source = await addImportedHistory(db, session);
      await db
        .update(importedPaymentHistory)
        .set({ receiptDocumentUrl: "https://untrusted.example/receipt.pdf" })
        .where(eq(importedPaymentHistory.id, source.historyId));
    });
    expect(hrefsIn(element)).not.toContain("https://untrusted.example/receipt.pdf");
  });
});

/*
 * `?tripId=` — where the trip pulse's "N orders are awaiting payment ›" lands.
 * The database layer has always been able to filter by departure; until this,
 * the page dropped the param on the floor and the fact opened on every open
 * order the shop had, which is the one thing a pulse fact must never do.
 */
describe("the trip filter", () => {
  const TRIP_TITLE = "Two-Tank Reef — Molasses & French";

  /**
   * A shop whose seeded reef trip carries one open invoice against a seat.
   *
   * The demo seed has open orders (`seed-orders.ts`) and booking-linked orders
   * (`seed-history.ts`) but no order that is both, so the departure filter has
   * nothing of its own to find until this writes one. The whole fixture is one
   * database, shared by every render in a test: trip ids are random per seed,
   * so a `tripId` read from one `seededTestDb` means nothing in the next.
   */
  async function shopWithAnInvoicedSeat() {
    const { db, session } = await sessionFor("owner");
    const shopId = session.user.shopId;
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shopId), eq(trips.title, TRIP_TITLE)))
      .limit(1);
    if (!trip) throw new Error(`the seed has no trip titled ${TRIP_TITLE}`);
    const [booking] = await db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.tripId, trip.id))
      .limit(1);
    if (!booking) throw new Error("the seeded reef trip has no bookings");
    const invoice = (kind: string, bookingId: string | null) => ({
      shopId,
      bookingId,
      personId: booking.personId,
      createdByPersonId: session.user.personId,
      status: "open" as const,
      currency: "usd",
      totalCents: 12_000,
      amountPaidCents: 0,
      description: `${kind} balance`,
      stripeAccountId: "acct_test",
      stripeCustomerId: `cus_test_${trip.id}`,
      stripeInvoiceId: `in_test_${kind}_${trip.id}`,
      createdAt: nowDate(),
      updatedAt: nowDate(),
    });
    // One against a seat on the reef trip, and one counter sale on no trip at
    // all — so "narrowed" is a claim with something to narrow away from.
    await db.insert(orders).values([invoice("seat", booking.id), invoice("counter", null)]);
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(session);
    return { tripId: trip.id };
  }

  /** Every `/orders/<id>` row link — one per order the page decided to list. */
  const listedOrders = (element: unknown) =>
    hrefsIn(element).filter((href) => /\/orders\/[0-9a-f-]{36}$/.test(href)).length;

  it("narrows the list to that departure's orders", async () => {
    const { tripId } = await shopWithAnInvoicedSeat();

    // Unfiltered, the counter sale is on screen too — so the filtered render
    // below is demonstrably dropping rows rather than finding an already-empty
    // page.
    expect(listedOrders(await renderWith({ status: "open", range: "all" }))).toBeGreaterThan(1);

    // The shape the trip pulse's "N orders are awaiting payment ›" links to.
    expect(listedOrders(await renderWith({ tripId, status: "open", range: "all" }))).toBe(1);
  });

  it("keeps the departure in the filter form", async () => {
    const { tripId } = await shopWithAnInvoicedSeat();
    const element = await renderWith({ tripId, status: "open", range: "all" });

    // The date range is now a filter control rather than a prose toggle. The
    // departure remains a hidden form field, so applying any filter does not
    // silently widen the list back out to the whole shop.
    expect(hiddenInputNamesIn(element)).toContain("tripId");
  });

  it("treats a malformed departure id as no filter at all", async () => {
    await shopWithAnInvoicedSeat();
    // `trips.id` is a `uuid` column: a stray `?tripId=` reaching the query is
    // not an empty list but a thrown "invalid input syntax for type uuid". The
    // same courtesy `?from=`/`?to=` already get — a mistyped param is not a
    // filter, and never a 500.
    const element = await renderWith({ tripId: "nope", status: "open", range: "all" });
    expect(listedOrders(element)).toBeGreaterThan(1);
    expect(hrefsIn(element).filter((href) => href.includes("tripId="))).toEqual([]);
  });

  it("still says which departure it filtered for when nothing matches", async () => {
    const { tripId } = await shopWithAnInvoicedSeat();
    // No order on this trip was ever voided, so this is the empty screen —
    // which is exactly where "orders for which boat?" needs answering. The
    // line renders only when the *lookup* found a title, never off `rows[0]`,
    // and it carries the way back to the departure itself.
    const element = await renderWith({ tripId, status: "void" });
    expect(listedOrders(element)).toBe(0);
    expect(hrefsIn(element)).toContain(`/shop/${SHOP_SLUG}/trips/${tripId}`);
  });
});

/*
 * `?personId=` — the roster's and the diver record's link into this page. It
 * was the one filter here that still handed its raw string to a `uuid` column,
 * so a truncated link 500'd a staff page (FU-20260814-orders-stray-person-id-500).
 */
describe("the diver filter", () => {
  /** Every `/orders/<id>` row link — one per order the page decided to list. */
  const listedOrders = (element: unknown) =>
    hrefsIn(element).filter((href) => /\/orders\/[0-9a-f-]{36}$/.test(href)).length;

  /**
   * A shop billing two different divers — so "narrowed to one of them" is a
   * claim with something to narrow away from. The lean unit-test template is
   * deliberately order-free (`src/db/seed.ts`), so the rows are written here.
   */
  async function shopWithOrders() {
    const { db, session } = await sessionFor("owner");
    const shopId = session.user.shopId;
    const booked = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(eq(trips.shopId, shopId));
    const [first, second] = [...new Set(booked.map((row) => row.personId))];
    if (!first || !second) throw new Error("the seed has fewer than two booked divers");
    await db.insert(orders).values(
      [first, second].map((personId, index) => ({
        shopId,
        bookingId: null,
        personId,
        createdByPersonId: session.user.personId,
        status: "open" as const,
        currency: "usd",
        totalCents: 9_000,
        amountPaidCents: 0,
        description: `counter sale ${index}`,
        stripeAccountId: "acct_test",
        stripeCustomerId: `cus_test_person_${index}`,
        stripeInvoiceId: `in_test_person_${index}`,
        createdAt: nowDate(),
        updatedAt: nowDate(),
      })),
    );
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(session);
    return { personId: first };
  }

  it("narrows the list to that diver's orders", async () => {
    const { personId } = await shopWithOrders();
    // The claim the malformed case below rests on: this filter is live, so
    // "unfiltered" is a distinguishable outcome rather than the only one.
    expect(listedOrders(await renderWith({ range: "all" }))).toBeGreaterThan(1);
    expect(listedOrders(await renderWith({ personId, range: "all" }))).toBe(1);
  });

  it("treats a malformed diver id as no filter at all", async () => {
    await shopWithOrders();
    const all = listedOrders(await renderWith({ range: "all" }));
    // `orders.person_id` is a `uuid` column, so a stray `?personId=nope`
    // reaching the query is not an empty list but a thrown "invalid input
    // syntax for type uuid" — a 500 on a page a staffer only mistyped their
    // way onto. Same courtesy `?status=`, `?from=`, `?to=` and `?tripId=` get.
    const element = await renderWith({ personId: "nope", range: "all" });
    expect(listedOrders(element)).toBe(all);
    // And it leaves no trace: no hidden rider, no filter pinned on the page's
    // own links, so the staffer is not carrying the bad id around with them.
    expect(hiddenInputNamesIn(element)).not.toContain("personId");
    expect(hrefsIn(element).filter((href) => href.includes("personId="))).toEqual([]);
  });
});
