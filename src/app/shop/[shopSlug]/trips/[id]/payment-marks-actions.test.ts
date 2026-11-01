import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { addPartySeat, createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import { activityEvents, trips } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext, type seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test.
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
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { markPaymentAction } = await import("./roster-payment-actions");
const { markPartyPaidAction, previewPartyPaymentAction } = await import("./party-payment-actions");

type SeededContext = Awaited<ReturnType<typeof seededShopContext>>;
let activeSurface: Pick<SeededContext, "db" | "shop"> | null = null;

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  activeSurface = { db, shop };
  const all = await upcomingTripsWithCounts(db, shop.id);
  const trip = all.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!trip) throw new Error("expected seeded trip missing");
  return {
    db,
    shop,
    tripId: trip.id,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  if (!activeSurface) throw new Error("test surface is not initialized");
  const surface = activeSurface;
  const session = staffSession({ shopId: shop.id, shopSlug: shop.slug, personId });
  vi.mocked(requireShopSurface).mockImplementation(async () => ({
    session,
    db: surface.db,
    shop: surface.shop,
  }));
}

/** A fresh unpaid seat on a $120 departure, so every balance below is known. */
async function unpaidSeatAt120(db: AppDb, shopId: string, tripId: string) {
  await db.update(trips).set({ priceCents: 12_000 }).where(eq(trips.id, tripId));
  const seated = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Ines Calloway",
    email: "ines.calloway@example.com",
  });
  if (!seated.ok) throw new Error("seat not booked");
  return seated.bookingId;
}

async function activityLines(db: AppDb, bookingId: string, code: string) {
  return db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.bookingId, bookingId), eq(activityEvents.code, code)));
}

/**
 * **Mark the party paid** (issue #2605). One payment across a lead's party,
 * each seat taking its balance owed first. The split is the server's, and no
 * seat is ever written off by it, so a captain may take it. Who may run each
 * action is filed in `actions.authz.test.ts`'s roster of intent.
 */
describe("marking a party paid", () => {
  function partyForm(leadBookingId: string, amount: string, method = "cash", owed = "36000") {
    const data = new FormData();
    data.set("bookingId", leadBookingId);
    data.set("expectedOwed", owed);
    data.set("amount", amount);
    data.set("method", method);
    return data;
  }

  /** A lead and two friends on the $120 departure, every seat unpaid. */
  async function partyOfThree(db: AppDb, shopId: string, tripId: string) {
    const leadBookingId = await unpaidSeatAt120(db, shopId, tripId);
    const friends: string[] = [];
    for (const seatName of ["Ada Calloway", "Milo Calloway"]) {
      const added = await addPartySeat(db, { shopId, leadBookingId, seatName });
      if (!added.ok) throw new Error(`seat ${seatName} refused`);
      friends.push(added.bookingId);
    }
    return { leadBookingId, friends };
  }

  it("lets a captain pay the whole party, one activity line per seat", async () => {
    const { db, shop, tripId, captain } = await context();
    const { leadBookingId, friends } = await partyOfThree(db, shop.id, tripId);
    signIn(shop, captain);
    const to = await redirectedTo(() =>
      markPartyPaidAction(shop.slug, tripId, partyForm(leadBookingId, "360")),
    );
    expect(to).toContain("notice=party-paid");
    expect(to).not.toContain("party-paid-short");
    for (const id of [leadBookingId, ...friends]) {
      expect(await getBookingPayment(db, shop.id, id)).toMatchObject({
        status: "paid",
        amountCents: 12_000,
        method: "cash",
        recordedByPersonId: captain,
      });
      expect(await activityLines(db, id, "party_marked_paid")).toEqual([
        expect.objectContaining({ actorPersonId: captain }),
      ]);
      expect(await activityLines(db, id, "payment_balance_written_off")).toEqual([]);
    }
  });

  it.each(["captain", "owner"] as const)(
    "leaves a deposit and the rest owing on a short payment, taken by the %s",
    async (role) => {
      {
        const { db, shop, tripId, ...people } = await context();
        const { leadBookingId, friends } = await partyOfThree(db, shop.id, tripId);
        signIn(shop, people[role]);
        const to = await redirectedTo(() =>
          markPartyPaidAction(shop.slug, tripId, partyForm(leadBookingId, "150")),
        );
        expect(to).toContain("notice=party-paid-short");
        expect(await getBookingPayment(db, shop.id, leadBookingId)).toMatchObject({
          status: "paid",
          amountCents: 12_000,
        });
        // Ada takes the last $30 as a deposit; Milo is untouched.
        expect(await getBookingPayment(db, shop.id, friends[0] as string)).toMatchObject({
          status: "deposit_paid",
          amountCents: 3_000,
        });
        expect(await getBookingPayment(db, shop.id, friends[1] as string)).toBeNull();
        // Nobody was written off, whoever took the money.
        for (const id of [leadBookingId, ...friends]) {
          expect(await activityLines(db, id, "payment_balance_written_off")).toEqual([]);
        }
      }
    },
  );

  it("takes nothing when the form carries no owed total, or a stale one (issue 2605)", async () => {
    const { db, shop, tripId, owner } = await context();
    const { leadBookingId, friends } = await partyOfThree(db, shop.id, tripId);
    signIn(shop, owner);
    const missing = partyForm(leadBookingId, "100");
    missing.delete("expectedOwed");
    expect(await redirectedTo(() => markPartyPaidAction(shop.slug, tripId, missing))).toContain(
      "notice=party-changed",
    );
    expect(
      await redirectedTo(() =>
        markPartyPaidAction(shop.slug, tripId, partyForm(leadBookingId, "100", "cash", "35000")),
      ),
    ).toContain("notice=party-changed");
    for (const id of [leadBookingId, ...friends]) {
      expect(await getBookingPayment(db, shop.id, id)).toBeNull();
    }
  });

  it("refuses more than the party owes, and writes nothing", async () => {
    const { db, shop, tripId, owner } = await context();
    const { leadBookingId, friends } = await partyOfThree(db, shop.id, tripId);
    signIn(shop, owner);
    const to = await redirectedTo(() =>
      markPartyPaidAction(shop.slug, tripId, partyForm(leadBookingId, "360.01")),
    );
    expect(to).toContain("notice=party-over");
    for (const id of [leadBookingId, ...friends]) {
      expect(await getBookingPayment(db, shop.id, id)).toBeNull();
    }
  });

  it("asks for the amount and the method, never taking a blank as a write-off", async () => {
    const { db, shop, tripId, owner } = await context();
    const { leadBookingId } = await partyOfThree(db, shop.id, tripId);
    signIn(shop, owner);
    expect(
      await redirectedTo(() =>
        markPartyPaidAction(shop.slug, tripId, partyForm(leadBookingId, "")),
      ),
    ).toContain("notice=payment-amount");
    const noMethod = partyForm(leadBookingId, "100");
    noMethod.delete("method");
    expect(await redirectedTo(() => markPartyPaidAction(shop.slug, tripId, noMethod))).toContain(
      "notice=payment-method",
    );
    expect(await getBookingPayment(db, shop.id, leadBookingId)).toBeNull();
  });

  it("refuses the whole party when one seat that owes was paid online, and keeps its Stripe pointer", async () => {
    const { db, shop, tripId, captain } = await context();
    const { leadBookingId, friends } = await partyOfThree(db, shop.id, tripId);
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: friends[1] as string,
      status: "deposit_paid",
      currency: "usd",
      amountCents: 2_000,
      provider: "stripe",
      providerRef: "pi_party_online",
    });
    signIn(shop, captain);
    const to = await redirectedTo(() =>
      markPartyPaidAction(shop.slug, tripId, partyForm(leadBookingId, "100")),
    );
    expect(to).toContain("notice=payment-online");
    expect(await getBookingPayment(db, shop.id, leadBookingId)).toBeNull();
    expect(await getBookingPayment(db, shop.id, friends[1] as string)).toMatchObject({
      provider: "stripe",
      providerRef: "pi_party_online",
    });
  });

  it("finds no party for a seat that is not on this departure's roster", async () => {
    const { db, shop, tripId, owner } = await context();
    await partyOfThree(db, shop.id, tripId);
    signIn(shop, owner);
    const to = await redirectedTo(() =>
      markPartyPaidAction(
        shop.slug,
        tripId,
        partyForm("00000000-0000-4000-8000-000000000000", "100"),
      ),
    );
    expect(to).toContain("notice=invalid");
  });

  it("previews the split without writing it, then carries the ask on the URL", async () => {
    const { db, shop, tripId, captain } = await context();
    const { leadBookingId, friends } = await partyOfThree(db, shop.id, tripId);
    signIn(shop, captain);
    const to = await redirectedTo(() =>
      previewPartyPaymentAction(shop.slug, tripId, partyForm(leadBookingId, "$150.00", "card")),
    );
    const params = new URL(to, "https://dive.day").searchParams;
    expect(params.get("notice")).toBe("party-preview");
    expect(params.get("partyLead")).toBe(leadBookingId);
    expect(params.get("partyAmount")).toBe("15000");
    expect(params.get("partyMethod")).toBe("card");
    for (const id of [leadBookingId, ...friends]) {
      expect(await getBookingPayment(db, shop.id, id)).toBeNull();
    }
  });

  it("refuses to preview an overpayment", async () => {
    const { db, shop, tripId, captain } = await context();
    const { leadBookingId } = await partyOfThree(db, shop.id, tripId);
    signIn(shop, captain);
    expect(
      await redirectedTo(() =>
        previewPartyPaymentAction(shop.slug, tripId, partyForm(leadBookingId, "1000")),
      ),
    ).toContain("notice=party-over");
  });
});

/** A Paid mark's own form, as the roster's control posts it. */
function paymentForm(bookingId: string, status: string): FormData {
  const data = new FormData();
  data.set("bookingId", bookingId);
  data.set("status", status);
  return data;
}

describe("a Paid mark the server refuses", () => {
  /**
   * Issue #2607: a refused Paid mark reopens holding what was typed. The amount
   * rides the redirect as the parsed figure in cents, the status and method as
   * their codes, and nothing else from the form does.
   */
  it("carries the typed amount and the picked status back when the Paid mark is refused", async () => {
    const { db, shop, tripId, captain } = await context();
    const booking = { id: await unpaidSeatAt120(db, shop.id, tripId) };

    signIn(shop, captain);
    const form = paymentForm(booking.id, "paid");
    form.set("amount", "$45.50");
    // No method: the action asks for it again.
    const to = await redirectedTo(() => markPaymentAction(shop.slug, tripId, form));

    const params = new URL(to, "https://dive.day").searchParams;
    expect(params.get("notice")).toBe("payment-method");
    expect(params.get("markStatus")).toBe("paid");
    expect(params.get("markAmount")).toBe("4550");
    expect(params.has("markMethod")).toBe(false);
  });

  it("carries the method back when the amount is the part refused, and never an unreadable amount", async () => {
    const { db, shop, tripId, captain } = await context();
    const booking = { id: await unpaidSeatAt120(db, shop.id, tripId) };

    signIn(shop, captain);
    const form = paymentForm(booking.id, "paid");
    form.set("amount", "lots");
    form.set("method", "cash");
    const to = await redirectedTo(() => markPaymentAction(shop.slug, tripId, form));

    const params = new URL(to, "https://dive.day").searchParams;
    expect(params.get("notice")).toBe("payment-amount");
    expect(params.get("markMethod")).toBe("cash");
    expect(params.has("markAmount")).toBe(false);
    expect(to).not.toContain("lots");
  });

  it("adds nothing to the URL when a non-money status is refused", async () => {
    const { db, shop, tripId, captain } = await context();
    const booking = { id: await unpaidSeatAt120(db, shop.id, tripId) };

    signIn(shop, captain);
    const to = await redirectedTo(() =>
      markPaymentAction(shop.slug, tripId, paymentForm(booking.id, "refunded")),
    );
    expect(to).toContain("notice=not-authorized");
    expect(to).not.toContain("markStatus");
  });
});

/**
 * Who may run each party action is filed in the trip page's roster of intent
 * (`actions.authz.test.ts`) for every other action file. These two refuse
 * nobody on role, and the reason is the point: the split never writes a seat
 * off, so the owner-or-manager right (H-20261014-paid-mark-amount-and) has nothing here to gate.
 */
describe("the party payment actions' gate", () => {
  it("refuses nobody on a role, because the split can never write a seat off", () => {
    const source = readFileSync(
      new URL("./party-payment-actions.ts", import.meta.url).pathname
        .replace(/%5B/g, "[")
        .replace(/%5D/g, "]"),
      "utf8",
    );
    expect(source).not.toContain("not-authorized");
    expect(source).not.toMatch(/canPerson/);
    expect(source).not.toMatch(/\bwaived\b|\brefunded\b/);
    expect(source).toContain("requireShopSurface");
  });
});
