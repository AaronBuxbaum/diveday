import { and, eq, inArray, ne } from "drizzle-orm";
import Link from "next/link";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "@/components/ui/badge";
import { tapTargetLinkClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import {
  bookingPayments,
  bookings,
  importedPaymentHistory,
  orders,
  paymentOperationIntents,
  people,
  trips,
} from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import { setTripStatus } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { calendarDateToUtcMidnight } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { capturedPaymentStatuses } from "@/lib/payment-source";
import { seededTestDb } from "@/test/db";
import { ariaLabelsIn, findElements, hrefsIn } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { demoteOwnerToManager } from "@/test/staff-session";
import { type OrderLedgerDay, OrdersLedger } from "./_components/OrdersLedger";
import { OrdersToolbar } from "./_components/OrdersToolbar";

// Same mocking shape as ../settings/SettingsPage.test.tsx: the page is invoked
// directly, outside Next's request scope, so the three things that only exist
// inside one (the db handle, better-auth, and request headers) are stubbed and
// nothing else.
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
const OrdersIndexPage = (await import("./page")).default;

const SHOP_SLUG = "blue-mantis";

/** A session for the seeded staff member who really holds `role`, roles and all. */
async function sessionFor(role: Role): Promise<{ db: AppDb; session: DiveDaySession }> {
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
        email: "staff@demo.invalid",
        roles: member.roles,
      },
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

async function renderOrders(
  role: Role,
  seed?: (db: AppDb, session: DiveDaySession) => Promise<void>,
) {
  const { db, session } = await sessionFor(role);
  if (seed) await seed(db, session);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  return renderWith();
}

/**
 * The day groups the page handed the ledger. The rows live in a prop rather
 * than in `children`, so the tree walkers cannot see them — and reading the
 * view model is the more exact question anyway: "what did this page decide to
 * put on a row?".
 */
function ledgerDays(element: unknown): OrderLedgerDay[] {
  return findElements<{ days: OrderLedgerDay[] }>(element, OrdersLedger)[0]?.props.days ?? [];
}

/** One per order the page decided to list, across every day group. */
const listedOrders = (element: unknown) =>
  ledgerDays(element).reduce((total, day) => total + day.rows.length, 0);

/** The toolbar the page built, or `undefined` when it stood down entirely. */
function toolbarProps(element: unknown) {
  return findElements<{ personId?: string; tripId?: string; clearHref?: string }>(
    element,
    OrdersToolbar,
  )[0]?.props;
}

/**
 * An intent that started long enough ago to count as never having resolved.
 * Anchored to `nowDate()`, not the wall clock: the unit-test harness freezes
 * `DIVEDAY_CLOCK`, and `listStuckPaymentOperations` measures staleness against
 * that frozen instant — a real `Date.now()` here is a full fortnight in its
 * future and reads as an operation that started moments ago.
 */
async function stickAnOperation(db: AppDb, session: DiveDaySession) {
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

/**
 * Both back-office notices with a row on a departure: an unconfirmed Stripe
 * checkout for a trip, and money owed on a trip the shop called off with its
 * paid seats still paid. The seeded shop's paid seats are real money once
 * their departure is cancelled, which is all `listOwedShopCancellationRefunds`
 * asks.
 */
async function troubleOnADeparture(db: AppDb, session: DiveDaySession) {
  const shopId = session.user.shopId;
  const [paid] = await db
    .select({ tripId: bookings.tripId })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        inArray(bookingPayments.status, [...capturedPaymentStatuses]),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!paid) throw new Error("the seed has no paid seat to owe back");
  await setTripStatus(db, shopId, paid.tripId, "cancelled");
  await db.insert(paymentOperationIntents).values({
    shopId,
    kind: "checkout_session",
    status: "started",
    tripId: paid.tripId,
    stripeObjectId: "cs_stuck",
    startedAt: new Date(nowDate().getTime() - 60 * 60 * 1000),
  });
}

type Node = ReactElement<{ children?: unknown; className?: string; href?: string }>;

/** The words under a node, in order, as a reader would read them. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as Node).props.children);
  return "";
}

/** A node's rendered children, the `null`s of its conditionals dropped. */
function childrenOf(node: Node): Node[] {
  return [node.props.children]
    .flat(Number.POSITIVE_INFINITY)
    .filter((child): child is Node => typeof child === "object" && child !== null);
}

/** The notice a section's `aria-label` names. */
function notice(tree: unknown, label: string): Node {
  const section = findElements<{ "aria-label"?: string; children?: unknown }>(tree, "section").find(
    (element) => element.props["aria-label"] === label,
  );
  if (!section) throw new Error(`no "${label}" notice on the page`);
  return section as unknown as Node;
}

/**
 * An unconfirmed invoice for one diver's seat, so its row names both the
 * departure and the diver — the two facts the danger list joins.
 */
async function stickABookingsInvoice(db: AppDb, session: DiveDaySession) {
  const shopId = session.user.shopId;
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), ne(bookings.status, "cancelled")))
    .limit(1);
  if (!booking) throw new Error("the seed has no booking");
  await db.insert(paymentOperationIntents).values({
    shopId,
    kind: "invoice",
    status: "started",
    bookingId: booking.id,
    stripeObjectId: "in_seat",
    startedAt: new Date(nowDate().getTime() - 60 * 60 * 1000),
  });
}

/**
 * The classes in effect on an element inside one of a list's rows: its plain
 * ones always, and its `group-last/op:` ones only on the row that is the
 * list's last child, which is what Tailwind's `:where(.group\/op):last-child *`
 * selects.
 */
function inEffect(className: string | undefined, rowIsLast: boolean): string[] {
  return (className?.split(" ") ?? []).flatMap((token) => {
    if (!token.startsWith("group-last/op:")) return [token];
    return rowIsLast ? [token.slice("group-last/op:".length)] : [];
  });
}

describe("the notices' rows", () => {
  /**
   * **Only the last row's reference bleeds into the notice's padding**
   * (pixel-craft class 5; K-388). The summary wraps a 16px `text-xs` line in a
   * 44px box, and on the last row that box sat on the notice's `py-3`: 13px
   * from the border to the heading's ink, 27px from "Stripe reference" to the
   * border. There its bottom 14px overhang the padding. On any other row the
   * same margin collapsed into the gap below it and pulled the next row up
   * under the reference, which then read as that row's, with its 44px box and
   * focus ring reaching into that row's first line. Only the bottom ever
   * bleeds; bleeding the top too would lift the ring across the row above.
   */
  it("lets only the last Stripe reference's target overhang the notice's foot", async () => {
    const tree = await renderOrders("owner", async (db, session) => {
      await troubleOnADeparture(db, session);
      await stickAnOperation(db, session);
    });
    const rows = findElements<{ className?: string; children?: unknown }>(
      notice(tree, "Payments that need a check"),
      "li",
    );
    expect(rows).toHaveLength(2);
    const effect = rows.map((row, index) => {
      expect(row.props.className?.split(" ")).toContain("group/op");
      const isLast = index === rows.length - 1;
      const [summary] = findElements<{ className?: string }>(row, "summary");
      const [code] = findElements<{ className?: string }>(row, "code");
      expect(textOf(summary)).toBe("Stripe reference");
      const summaryClasses = inEffect(summary?.props.className, isLast);
      expect(summaryClasses).toContain("min-h-11");
      expect(summaryClasses).not.toContain("-my-3.5");
      return {
        bleeds: summaryClasses.includes("-mb-3.5"),
        // Open, the id starts 4px under the 44px box on every row: `mt-1`,
        // or 14 + 4 where the box has given its 14px back.
        idGap: inEffect(code?.props.className, isLast)
          .filter((token) => /^mt-/.test(token))
          .at(-1),
      };
    });
    expect(effect).toEqual([
      { bleeds: false, idGap: "mt-1" },
      { bleeds: true, idGap: "mt-4.5" },
    ]);
  });

  /**
   * **"Open trip" is a 44px target on a 20px line** (pixel-craft class 7;
   * K-389). Both notices drew it as a plain underlined word, 61.8×20px. The
   * link takes `tapTargetLinkClass` inside a wrapper exactly one `text-sm`
   * line tall, so the box a finger meets is 44px and the line stays 20px.
   */
  it("makes every Open trip a 44px target that keeps its line", async () => {
    const tree = await renderOrders("owner", troubleOnADeparture);
    for (const label of ["Payments that need a check", "Refunds you still owe"]) {
      const section = notice(tree, label);
      const links = findElements<{ className?: string; href?: string }>(section, Link).filter(
        (link) => textOf(link) === "Open trip",
      );
      expect(links.length, label).toBeGreaterThan(0);
      const wrappers = findElements<{ className?: string; children?: unknown }>(section, "span");
      for (const link of links) {
        expect(link.props.className).toContain(tapTargetLinkClass);
        const wrapper = wrappers.find((span) => childrenOf(span as Node).includes(link as Node));
        expect(wrapper?.props.className?.split(" ")).toEqual(
          expect.arrayContaining(["h-5", "items-center"]),
        );
      }
    }
  });

  /**
   * **Two rows' targets meet and never cross** (pixel-craft class 7; K-389).
   * Each "Open trip" box is 44px on a 20px line, so it spills 12px above and
   * below. At `space-y-2` two one-line rows stood 28px apart and their boxes
   * crossed by 16px; the later link paints over the earlier and took a click
   * on the earlier one's underline, opening the next diver's departure. A
   * 20px line plus the gap has to be the 44px target.
   */
  it("stands the notices' rows at least a target apart", async () => {
    const tree = await renderOrders("owner", troubleOnADeparture);
    for (const label of ["Payments that need a check", "Refunds you still owe"]) {
      const [list] = findElements<{ className?: string }>(notice(tree, label), "ul");
      const gap = list?.props.className?.match(/(?:^| )space-y-(\d+(?:\.\d+)?)(?: |$)/)?.[1];
      expect(gap, label).toBeDefined();
      expect(20 + Number(gap) * 4, label).toBeGreaterThanOrEqual(44);
    }
  });

  /**
   * **An owed row is one run of text that never opens a line on a dot**
   * (pixel-craft class 4; K-569). Its facts were flex items, `<span>· {trip}
   * </span>` and a muted `· $60.00 · …`, so the row spaced its dots two ways
   * and, wrapped at 390, began lines "· $60.00". Joined into one flex item they
   * still moved off the name's line whole on a phone and pushed "Open trip" to
   * a line of its own. As running text the row breaks only after a dot or
   * inside the trip's words, and every dot is bound to the word before it.
   */
  it("runs an owed row as text whose dots are bound to the word before", async () => {
    const tree = await renderOrders("owner", troubleOnADeparture);
    const rows = findElements<{ className?: string; children?: unknown }>(
      notice(tree, "Refunds you still owe"),
      "li",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.props.className?.split(" ") ?? []).not.toContain("flex");
      const text = textOf(row);
      expect(text).toContain("·");
      expect(text, text).not.toMatch(/ ·/);
      expect(text.endsWith(" Open trip"), text).toBe(true);
    }
  });

  /**
   * **The danger list binds its dot the same way** (pixel-craft class 4;
   * K-569). It joined its departure and diver with an ordinary space before
   * the dot, so at 390 a line could open on "· Priya Sharma".
   */
  it("binds the dot between a stuck payment's departure and diver", async () => {
    const tree = await renderOrders("owner", stickABookingsInvoice);
    const [row] = findElements<{ children?: unknown }>(
      notice(tree, "Payments that need a check"),
      "p",
    ).filter((paragraph) => textOf(paragraph).includes("·"));
    const text = textOf(row);
    expect(text).toContain(" · ");
    expect(text, text).not.toMatch(/ ·/);
  });
});

describe("imported payment history", () => {
  const PANEL = "Imported payment history";

  async function addImportedHistory(db: AppDb, session: DiveDaySession) {
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
    // The `Unverified` mark rides the disclosure's own summary line now, where
    // it says once about the whole folded section what it used to repeat on
    // every row of a permanently open table.
    const disclosure = findElements<{ meta?: unknown; folded?: boolean }>(element, LedgerGroup)[0];
    expect(disclosure?.props.folded).toBe(true);
    expect(
      findElements<{ children?: unknown }>(disclosure?.props.meta, Badge).some(
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

  it("narrows the list to that departure's orders", async () => {
    const { tripId } = await shopWithAnInvoicedSeat();

    // Unfiltered, the counter sale is on screen too — so the filtered render
    // below is demonstrably dropping rows rather than finding an already-empty
    // page.
    expect(listedOrders(await renderWith({ status: "open", range: "all" }))).toBeGreaterThan(1);

    // The shape the trip pulse's "N orders are awaiting payment ›" links to.
    expect(listedOrders(await renderWith({ tripId, status: "open", range: "all" }))).toBe(1);
  });

  it("keeps the departure in the toolbar", async () => {
    const { tripId } = await shopWithAnInvoicedSeat();
    const element = await renderWith({ tripId, status: "open", range: "all" });

    // The departure has no control of its own — it arrives from the trip
    // pulse's link — so the toolbar carries it as a hidden rider. Without it,
    // changing the status silently widens the list back out to the whole shop,
    // which is what this form's missing `personId` used to do.
    expect(toolbarProps(element)?.tripId).toBe(tripId);
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
    expect(toolbarProps(element)?.personId).toBeUndefined();
    expect(hrefsIn(element).filter((href) => href.includes("personId="))).toEqual([]);
  });
});

/**
 * The day ledger's own pin — ADR 20260827-clearwater-surface-language,
 * decision 7. `OrdersLedger.test.tsx` proves the component renders its group's
 * date once; this proves the page never hands a row one to render, which is
 * the half a component test cannot see.
 */
describe("the day ledger", () => {
  /**
   * Two orders on one day and one on another, written directly: the lean
   * unit-test template is deliberately order-free (`src/db/seed.ts`), and the
   * instants below straddle New York's midnight so the grouping is the shop's
   * day rather than the server's.
   */
  async function shopWithADayOfOrders() {
    const { db, session } = await sessionFor("owner");
    const shopId = session.user.shopId;
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shopId))
      .limit(1);
    if (!diver) throw new Error("the seeded shop has no people");
    await db.insert(orders).values(
      [
        { at: "2026-08-27T15:00:00Z", cents: 14_800 },
        { at: "2026-08-27T13:00:00Z", cents: 12_000 },
        { at: "2026-08-27T02:00:00Z", cents: 9_000 },
      ].map(({ at, cents }, index) => ({
        shopId,
        personId: diver.id,
        createdByPersonId: session.user.personId,
        status: "paid" as const,
        currency: "usd",
        totalCents: cents,
        amountPaidCents: cents,
        description: `counter sale ${index}`,
        stripeAccountId: "acct_test",
        stripeCustomerId: `cus_test_day_${index}`,
        stripeInvoiceId: `in_test_day_${index}`,
        createdAt: new Date(at),
        updatedAt: new Date(at),
      })),
    );
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(session);
  }

  it("puts the date in the group header and in no row on that day", async () => {
    await shopWithADayOfOrders();
    const days = ledgerDays(await renderWith({ range: "all" }));
    expect(days.length).toBeGreaterThan(1);

    for (const day of days) {
      // The date the header is built from, derived from the group's own key
      // rather than from a row — a calendar day has no instant in it, so it
      // formats from its UTC midnight in UTC.
      const date = formatShortDate(calendarDateToUtcMidnight(day.key), "en-US", "UTC");
      expect(day.label).toContain(date);
      for (const row of day.rows) {
        expect([row.diver, row.detail ?? "", row.amount, row.linkLabel].join(" ")).not.toContain(
          date,
        );
      }
    }
  });

  it("states the day's own count and money on the day's header", async () => {
    await shopWithADayOfOrders();
    const days = ledgerDays(await renderWith({ range: "all" }));
    const thursday = days.find((day) => day.key === "2026-08-27");
    // Two of the three orders are Thursday's in New York; the 02:00Z one is
    // Wednesday evening there, and its money belongs to Wednesday.
    expect(thursday?.rows).toHaveLength(2);
    expect(thursday?.meta).toBe("2 orders · $268.00");
  });
});
