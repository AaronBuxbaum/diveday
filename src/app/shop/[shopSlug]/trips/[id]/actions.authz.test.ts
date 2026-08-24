import { readFileSync } from "node:fs";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import { bookings, tripRequirements, trips } from "@/db/schema";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * Two different gates live in this file, and the line between them is the point:
 *
 * - `requireTripConfig` — what the dive *is* and who it admits. A captain runs
 *   the boat but does not get to lower the certification a trip demands, which
 *   is a safety gate, not a preference.
 * - `canPersonRefund` inside `removeBookingAction` — a captain *may* free a seat
 *   (roster work) but the auto-refund must not fire under a role that cannot
 *   move money; the paid booking is handed up to an owner/manager instead.
 *
 * Neither `upsertTripRequirements` nor `setTripStatus` re-checks anything below
 * this layer, so the assertions look at the rows afterwards, not just the notice.
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
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// The money seam. Mocked so a refusal can be checked where the refund would
// actually have been issued, rather than inferred from a notice string.
vi.mock("@/db/refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/refunds")>();
  return { ...actual, refundBookingOnCancellation: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { refundBookingOnCancellation } = await import("@/db/refunds");
const {
  markPaymentAction,
  removeBookingAction,
  reinstateTripAction,
  saveRequirementsAction,
  sendLastMinuteDealAction,
} = await import("./actions");

/**
 * A seeded ordinary charter — not a course session, whose rules are frozen —
 * that already demands a certification and a waiver. Picking a trip with
 * requirements is what makes "the row did not change" mean anything: against a
 * trip with no requirements row, every such assertion would pass vacuously.
 */
async function seededTripId(db: AppDb, shopId: string): Promise<string> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(tripRequirements, eq(tripRequirements.tripId, trips.id))
    .innerJoin(bookings, and(eq(bookings.tripId, trips.id), eq(bookings.status, "booked")))
    .where(
      and(
        eq(trips.shopId, shopId),
        isNull(trips.courseId),
        isNotNull(tripRequirements.minimumCertificationLevel),
        eq(tripRequirements.requiresWaiver, true),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!trip) throw new Error("seeded shop has no gated non-course trip");
  return trip.id;
}

async function requirementsOf(db: AppDb, tripId: string) {
  const [row] = await db.select().from(tripRequirements).where(eq(tripRequirements.tripId, tripId));
  if (!row) throw new Error("trip requirements vanished");
  return row;
}

async function bookingRow(db: AppDb, bookingId: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking vanished");
  return row;
}

/** A booked seat on `tripId`, marked paid so a refund is genuinely at stake. */
async function paidBookingId(db: AppDb, shopId: string, tripId: string): Promise<string> {
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), eq(bookings.status, "booked")))
    .limit(1);
  if (!booking) throw new Error("seeded trip has no active booking");
  await setBookingPayment(db, {
    shopId,
    bookingId: booking.id,
    status: "paid",
    amountCents: 12_000,
    currency: "usd",
  });
  return booking.id;
}

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  activeSurface = { db, shop };
  return {
    db,
    shop,
    tripId: await seededTripId(db, shop.id),
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

type SeededContext = Awaited<ReturnType<typeof seededShopContext>>;
let activeSurface: Pick<SeededContext, "db" | "shop"> | null = null;

function signIn(shop: { id: string; slug: string }, personId: string) {
  if (!activeSurface) throw new Error("test surface is not initialized");
  const surface = activeSurface;
  const session = staffSession({ shopId: shop.id, shopSlug: shop.slug, personId });
  vi.mocked(requireShopSurface).mockImplementation(async (_shopSlug, options) => {
    if (options?.allow && !(await options.allow(surface.db, shop.id, personId))) {
      throw new Error(
        `REDIRECT:${noticeUrl(
          shopPath(shop.slug, ...(options.refusal.landing ?? [])),
          options.refusal.notice,
        )}`,
      );
    }
    return {
      session,
      db: surface.db,
      shop: surface.shop,
    };
  });
}

function requirementsForm(
  minimumCertificationLevel: string,
  toggles: { requiresWaiver?: boolean; requiresPayment?: boolean } = { requiresWaiver: true },
): FormData {
  const formData = new FormData();
  formData.set("minimumCertificationLevel", minimumCertificationLevel);
  if (toggles.requiresWaiver) formData.set("requiresWaiver", "on");
  if (toggles.requiresPayment) formData.set("requiresPayment", "on");
  return formData;
}

/** One booking's payment submission, as the roster's control posts it. */
function paymentForm(bookingId: string, status: string): FormData {
  const data = new FormData();
  data.set("bookingId", bookingId);
  data.set("status", status);
  return data;
}

/** Strip a departure's price, to reach the unpriced-and-payment-gated state. */
async function clearPrice(db: AppDb, tripId: string) {
  await db.update(trips).set({ priceCents: null }).where(eq(trips.id, tripId));
}

/** The count a `requirements-blocking` redirect reports, or 0 for the plain notice. */
function blockedCountFrom(to: string): number {
  return Number(new URL(to, "https://dive.day").searchParams.get("count") ?? 0);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setting what a trip admits", () => {
  it("refuses a captain clearing the certification the trip demands", async () => {
    const { db, shop, tripId, captain } = await context();
    const before = await requirementsOf(db, tripId);
    signIn(shop, captain);
    // An empty select posts as `""`, which the action reads as "no C-card
    // required" — the cheapest possible forged post, and a safety gate.
    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("")),
    );

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=not-authorized`);
    expect(before.minimumCertificationLevel).not.toBeNull();
    expect((await requirementsOf(db, tripId)).minimumCertificationLevel).toBe(
      before.minimumCertificationLevel,
    );
  });

  it("refuses a captain dropping the waiver requirement", async () => {
    // An unticked checkbox is simply an absent field, so leaving `requiresWaiver`
    // out is all it takes to ask for a trip that needs no signed release.
    const { db, shop, tripId, captain } = await context();
    const before = await requirementsOf(db, tripId);
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("minimumCertificationLevel", before.minimumCertificationLevel ?? "");

    const to = await redirectedTo(() => saveRequirementsAction(shop.slug, tripId, formData));

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=not-authorized`);
    expect((await requirementsOf(db, tripId)).requiresWaiver).toBe(true);
  });

  it("lets an owner set the certification the trip demands", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("")),
    );

    // Nothing about the card ladder is demanded any more, so no booked diver
    // carries a certification blocker and the save settles on the plain notice.
    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=requirements`);
    expect((await requirementsOf(db, tripId))?.minimumCertificationLevel).toBeNull();
  });

  /**
   * **Tightening a gate under a roster that is already booked.** Readiness is
   * computed live, so those divers turn up blocked on Today, the board, the
   * roster, and the manifest the moment this saves — nothing here has to
   * re-check them. What was missing is that the staffer who tightened it walked
   * away not knowing, and found out when a diver did. It stays a notice, never
   * a refusal: a shop may legitimately tighten a gate and then work the roster.
   */
  it("tells an owner how many booked divers a tightened requirement just blocked", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("rescue")),
    );

    expect(to).toMatch(
      new RegExp(
        `^/shop/${shop.slug}/trips/${tripId}\\?notice=requirements-blocking&count=[1-9]\\d*$`,
      ),
    );
    // Saved regardless — the notice never stands in the way of the write.
    expect((await requirementsOf(db, tripId))?.minimumCertificationLevel).toBe("rescue");
  });

  /**
   * **The notice was quietest exactly where it had the most to say.**
   *
   * The count filtered blockers to `BLOCKER_CATEGORY === "certification"`, and
   * this form has four toggles. Ticking "Requires waiver" on a roster nobody
   * had signed, or "Requires payment" on a roster nobody had paid, blocked
   * every diver aboard and reported zero — then rendered the plain success
   * notice, which actively tells the staffer nobody was affected. Those two
   * are the toggles most likely to block a whole roster at once, because
   * certification varies diver by diver while "has anyone paid yet" does not
   * (issue #693).
   *
   * Nothing could have caught it: a test asserting the notice fires when the
   * certification gate tightens passes whether or not the other categories
   * count.
   */
  it("counts the divers a payment gate just blocked, not only certification ones", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);

    // Demand nothing about certification, so any count here is payment's.
    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("", { requiresPayment: true })),
    );

    expect(blockedCountFrom(to)).toBeGreaterThan(0);
    expect(to).toContain("notice=requirements-blocking");
    expect((await requirementsOf(db, tripId))?.requiresPayment).toBe(true);
  });

  it("counts the divers a waiver gate just blocked", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);
    // Clear the seeded gate first, so the roster starts unblocked and the
    // count below is what *this* save did rather than what was already true.
    await saveRequirementsAction(
      shop.slug,
      tripId,
      requirementsForm("", { requiresWaiver: false }),
    ).catch(() => {});

    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("", { requiresWaiver: true })),
    );

    expect(blockedCountFrom(to)).toBeGreaterThan(0);
    expect((await requirementsOf(db, tripId))?.requiresWaiver).toBe(true);
  });

  /**
   * **The other half of issue #692.** A payment gate on a departure with no
   * price asks nobody for money and blocks every diver who books it, forever —
   * `checkoutCharge` returns null, the booking action never reaches Stripe, and
   * `payment_due` stands with no route out from the diver's side. Refused
   * rather than saved and explained afterwards: there is no case where the
   * combination means anything.
   */
  it("refuses a payment gate on a departure with no price, and stores nothing", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);
    await clearPrice(db, tripId);
    const before = await requirementsOf(db, tripId);

    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("", { requiresPayment: true })),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/trips/${tripId}?notice=requirements-need-price&form=requirements`,
    );
    // Refused means refused: the rest of the form is not quietly saved either.
    expect(await requirementsOf(db, tripId)).toEqual(before);
  });

  it("still saves the other gates on an unpriced departure", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);
    await clearPrice(db, tripId);

    // The rule is about the *combination*. An unpriced charter that demands a
    // waiver and a card is ordinary, and must stay saveable.
    await redirectedTo(() => saveRequirementsAction(shop.slug, tripId, requirementsForm("rescue")));

    const saved = await requirementsOf(db, tripId);
    expect(saved?.minimumCertificationLevel).toBe("rescue");
    expect(saved?.requiresPayment).toBe(false);
  });

  /**
   * The difference, not the total. A departure where nobody had signed yet was
   * already showing those divers as blocked, so re-saving the same gate has
   * changed nothing for anybody and must say so — reporting them again would
   * be a different lie.
   */
  it("reports nobody when a save leaves every diver exactly as blocked as they were", async () => {
    const { shop, tripId, owner } = await context();
    signIn(shop, owner);
    await saveRequirementsAction(
      shop.slug,
      tripId,
      requirementsForm("rescue", { requiresWaiver: true }),
    ).catch(() => {});

    const to = await redirectedTo(() =>
      saveRequirementsAction(
        shop.slug,
        tripId,
        requirementsForm("rescue", { requiresWaiver: true }),
      ),
    );

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=requirements`);
  });
});

describe("putting a cancelled trip back on the board", () => {
  it("refuses a captain — cancelling today's charter is the crew's call, un-cancelling is not", async () => {
    const { db, shop, tripId, captain } = await context();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    signIn(shop, captain);

    const to = await redirectedTo(() => reinstateTripAction(shop.slug, tripId));

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=not-authorized`);
    const [after] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(after?.status).toBe("cancelled");
  });

  it("passes the route slug and trip landing to the throwing surface preamble", async () => {
    const { shop, tripId, captain } = await context();
    signIn(shop, captain);

    await redirectedTo(() => reinstateTripAction(shop.slug, tripId));

    expect(requireShopSurface).toHaveBeenCalledWith(shop.slug, {
      allow: expect.any(Function),
      refusal: { notice: "not-authorized", landing: ["trips", tripId] },
    });
  });

  it("lets an owner reinstate it", async () => {
    const { db, shop, tripId, owner } = await context();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    signIn(shop, owner);

    const to = await redirectedTo(() => reinstateTripAction(shop.slug, tripId));

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=reinstated`);
    const [after] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(after?.status).toBe("scheduled");
  });
});

describe("removing a paid diver from the manifest", () => {
  it("lets a captain free the seat but never issues the refund — that goes to an owner", async () => {
    const { db, shop, tripId, captain } = await context();
    const bookingId = await paidBookingId(db, shop.id, tripId);
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("bookingId", bookingId);

    const to = await redirectedTo(() => removeBookingAction(shop.slug, tripId, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/trips/${tripId}/guests?notice=booking-removed-refund-owner&bid=${bookingId}`,
    );
    // The seat really is free — this is not a blanket refusal of the action.
    expect((await bookingRow(db, bookingId)).status).toBe("cancelled");
    // And no money moved under a role that may not move it.
    expect(refundBookingOnCancellation).not.toHaveBeenCalled();
  });

  it("runs the refund when an owner removes the same booking", async () => {
    const { db, shop, tripId, owner } = await context();
    const bookingId = await paidBookingId(db, shop.id, tripId);
    vi.mocked(refundBookingOnCancellation).mockResolvedValue({ status: "refunded" } as never);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("bookingId", bookingId);

    const to = await redirectedTo(() => removeBookingAction(shop.slug, tripId, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/trips/${tripId}/guests?notice=booking-removed-refunded&bid=${bookingId}`,
    );
    expect(refundBookingOnCancellation).toHaveBeenCalledWith(expect.anything(), {
      shopId: shop.id,
      bookingId,
    });
  });
});

/**
 * **Every action in this file has a written-down answer, open or closed.**
 *
 * `requireTripConfig` was introduced for the configuration actions and named
 * for them, so it reads as "the trips gate" — and the nineteen actions that are
 * not about *configuring* a trip naturally did not take it. Two of those moved
 * money and nobody had noticed, because a test asserting "a captain may not
 * lower the certification gate" passes whether or not anything else is gated
 * (issue #714).
 *
 * So this is a roster of intent rather than a behaviour test. A new action that
 * is not listed here fails, which is the point: defaulting open by omission is
 * exactly how the last-minute blast and the payment write-off got in. Adding a
 * name to `OPEN_TO_ALL_STAFF` is a claim someone has to make deliberately, in a
 * diff a reviewer reads.
 */
describe("who may run each action on the trip page", () => {
  /** The dive itself and who it admits — never the crew's to change. */
  const TRIP_CONFIG = [
    "saveDetails",
    "saveRequirementsAction",
    "reinstateTripAction",
    "applySeriesDetailsAction",
    "cancelSeriesAction",
    "setSeriesRepeatAction",
    "updateSeriesCadenceAction",
    "cancelOffCadenceSeriesAction",
  ];

  /** Money: what a dive costs, and writing off what it earned. */
  const MONEY = ["sendLastMinuteDealAction", "markPaymentAction"];

  /**
   * The day's work, and deliberately open. Running the boat, the roster, the
   * notes, the wait list and the head count is what the crew are for, and
   * `src/lib/authz.ts` is explicit that these stay open. `removeBookingAction`
   * is the subtle one and has its own case above: a captain may free a seat,
   * and the refund that would otherwise fire is handed up to an owner.
   */
  const OPEN_TO_ALL_STAFF = [
    "recordTripPrintPdfAction",
    "saveConditionsAction",
    "clearConditionsAction",
    "cancelTripAction",
    // Cancelling one departure for weather is the crew's, and putting it back
    // is not — an asymmetry that reads like an oversight and is H-14's own
    // decision: its 2026-07-24 `dive-domain-expert` review lists reinstate
    // among trip *definition* and one departure's weather cancellation among
    // the day-of operating actions. So `cancelTripAction` takes the ordinary
    // preamble and `reinstateTripAction` calls `requireTripConfig`, and this
    // roster listed reinstate here anyway until issue #788 — precisely the
    // failure a name-only check cannot see.
    "addInternalNoteAction",
    "deleteInternalNoteAction",
    "restoreInternalNoteAction",
    "addToWaitlistAction",
    "inviteWaitlistAction",
    "recordTripInvitationAction",
    "createDirectTripInvitationAction",
    "removeBookingAction",
    "undoRemoveBookingAction",
    "confirmDiverIdentityAction",
    "markWaiverInPersonAction",
    "saveRosterEmergencyContactAction",
    // **Who is running the boat is the crew's own answer.** H-14's record
    // already said so — "day-of crew assignment (manifest accuracy)" is named
    // there among the actions that stay open — but `canConfigureTrips`'s
    // docstring claimed the opposite, and this roster wrote down the docstring.
    // Re-confirmed with Aaron on 2026-08-22 before correcting it (issue #788):
    // a captain swapping a divemaster at the dock does not wait for an owner.
    "updateTripCrewAction",
    // Same H-48 trust boundary as reviewCertification (any active staff
    // role, not instructor-only) — scoped to the surface rather than the
    // role: the tap only ever lands beside a name on that session's own
    // roster (issue #717).
    "certifyDiverFromRosterAction",
  ];

  /** Every exported action's source, sliced from its `export` to its closing brace. */
  function actionBodies(): Map<string, string> {
    const source = readFileSync(
      new URL("./actions.ts", import.meta.url).pathname.replace(/%5B/g, "[").replace(/%5D/g, "]"),
      "utf8",
    );
    const bodies = new Map<string, string>();
    for (const match of source.matchAll(/^export async function (\w+)/gm)) {
      const name = match[1];
      if (!name || match.index === undefined) continue;
      // A top-level function's closing brace is the only `}` at column zero
      // after it, because everything nested is indented. Brace-counting from
      // the signature is the obvious alternative and it is wrong here: a return
      // type of `Promise<{ ok: boolean }>` opens a brace before the body does,
      // and counting from that one ends the "body" at `}>`. That is not
      // hypothetical — `updateTripCrewAction` is written exactly that way, and
      // it is the action whose gate this file got wrong.
      const end = source.indexOf("\n}\n", match.index);
      bodies.set(name, source.slice(match.index, end === -1 ? undefined : end));
    }
    return bodies;
  }

  /**
   * Which list an action's *body* puts it in, read from the source.
   *
   * The three answers are distinguished by how the action refuses somebody,
   * which is the only thing that makes them different:
   *
   * - **`TRIP_CONFIG`** — the preamble is `requireTripConfig`, which re-reads
   *   live roles and bounces anyone `canPersonConfigureTrips` refuses.
   * - **`MONEY`** — somebody is refused on a money predicate. Sometimes in the
   *   preamble (`sendLastMinuteDealAction` passes `canPersonManagePaymentSettings`
   *   as `allow`), and sometimes further down: `markPaymentAction` takes the
   *   ordinary preamble and then refuses on `canPersonRefund`, because its gate
   *   is on the *transition* — recording cash at the dock is crew work, marking
   *   a booking written off is not. A check that only read preambles would call
   *   that entry wrong.
   * - **`OPEN_TO_ALL_STAFF`** — the ordinary preamble, and **nobody is refused
   *   at all**. `removeBookingAction` is the case that makes this the right
   *   test rather than "mentions no money predicate": it calls
   *   `canPersonRefund` and never refuses on it — a captain may free a seat,
   *   and the refund that would otherwise fire is handed up to an owner.
   */
  function gateInBody(body: string): string {
    if (/await requireTripConfig\(/.test(body)) return "TRIP_CONFIG";
    const refuses = body.includes('"not-authorized"');
    const weighsMoney = /canPerson(?:Refund|ManagePaymentSettings)\b/.test(body);
    if (refuses && weighsMoney) return "MONEY";
    if (refuses) return "REFUSES_SOMEBODY_UNACCOUNTED_FOR";
    return "OPEN_TO_ALL_STAFF";
  }

  it("files every exported action under the gate its own body carries", () => {
    const recorded = new Map<string, string>([
      ...TRIP_CONFIG.map((name) => [name, "TRIP_CONFIG"] as const),
      ...MONEY.map((name) => [name, "MONEY"] as const),
      ...OPEN_TO_ALL_STAFF.map((name) => [name, "OPEN_TO_ALL_STAFF"] as const),
    ]);
    const bodies = actionBodies();

    // Read off the file rather than off the module's exports: a `const` arrow
    // export would slip past the latter, and the point is that *nothing* new
    // lands here without an answer.
    expect([...bodies.keys()].filter((name) => !recorded.has(name))).toEqual([]);
    expect([...recorded.keys()].filter((name) => !bodies.has(name))).toEqual([]);

    // **The half the name-only version could not see.** Both of these were
    // already wrong when it was written (issue #788): `reinstateTripAction` was
    // filed open and calls `requireTripConfig`, and `updateTripCrewAction` was
    // filed as trip configuration and gates nobody. The first is harmless as
    // shipped and dangerous as documentation — a reader reconciling the code to
    // the roster removes a working gate. The second was two sources of truth
    // disagreeing with nothing to notice.
    const actual = Object.fromEntries([...bodies].map(([name, body]) => [name, gateInBody(body)]));
    expect(actual).toEqual(Object.fromEntries(recorded));
  });

  it("keeps the money actions apart from the trip-config ones", () => {
    // They are gated by different predicates for different reasons — a captain
    // may not lower a safety gate, and separately may not decide about money —
    // so an action must never be filed under both.
    expect(TRIP_CONFIG.filter((name) => MONEY.includes(name))).toEqual([]);
  });
});

/**
 * The two money actions themselves, which had no gate at all: a captain could
 * mint a percentage coupon on the shop's connected Stripe account and mail it
 * to a list of divers, on a departure whose price they are explicitly not
 * allowed to change (issue #714).
 */
describe("money on the trip page", () => {
  it("refuses a captain the last-minute deal blast", async () => {
    const { shop, tripId, captain } = await context();
    signIn(shop, captain);

    const form = new FormData();
    form.set("discountPercent", "25");

    const to = await redirectedTo(() => sendLastMinuteDealAction(shop.slug, tripId, form));

    expect(to).toContain("notice=not-authorized");
  });

  it("lets an owner send it", async () => {
    const { shop, tripId, owner } = await context();
    signIn(shop, owner);

    const form = new FormData();
    form.set("discountPercent", "25");

    // Not asserting a send here — the fleet configures no provider — only that
    // it is not the authorization refusal.
    const to = await redirectedTo(() => sendLastMinuteDealAction(shop.slug, tripId, form));
    expect(to).not.toContain("notice=not-authorized");
  });

  /**
   * **The way *out* of a write-off is a write-off too.**
   *
   * The first gate asked only "is this staffer entering `waived`/`refunded`",
   * which left the reverse wide open: a shop blows out a departure, the owner
   * refunds the seats, the bookings survive on the roster, and a captain marks
   * one `paid` again. `setBookingPayment` trusts its caller, so it lands.
   *
   * Three consequences, none of them cosmetic: reported revenue rises on money
   * that was returned (`COLLECTED_PAYMENT_STATUSES`), the row stops pointing at
   * the real Stripe refund, and the seat re-enters
   * `listOwedShopCancellationRefunds` — whose own docstring calls a `paid` row
   * on a cancelled trip "the obvious way to get this wrong".
   *
   * Found by `security-reviewer` after #714 shipped.
   */
  it("refuses a captain moving a refunded booking back to paid", async () => {
    const { db, shop, tripId, captain, owner } = await context();
    const [booking] = await db.select().from(bookings).where(eq(bookings.tripId, tripId)).limit(1);
    if (!booking) throw new Error("seeded trip has no bookings");

    // The owner writes the refund off, as they may.
    signIn(shop, owner);
    await redirectedTo(() =>
      markPaymentAction(shop.slug, tripId, paymentForm(booking.id, "refunded")),
    );

    signIn(shop, captain);
    const to = await redirectedTo(() =>
      markPaymentAction(shop.slug, tripId, paymentForm(booking.id, "paid")),
    );

    expect(to).toContain("notice=not-authorized");
    // And the row still says what the owner decided.
    const after = await getBookingPayment(db, shop.id, booking.id);
    expect(after?.status).toBe("refunded");
  });

  it("lets a captain re-submit a settled status without a confusing refusal", async () => {
    // The current status stays selectable in the control, so a captain looking
    // at a waived booking can submit `waived` unchanged. Refusing a tap that
    // changes nothing is the wrong answer to the right rule.
    const { db, shop, tripId, captain, owner } = await context();
    const [booking] = await db.select().from(bookings).where(eq(bookings.tripId, tripId)).limit(1);
    if (!booking) throw new Error("seeded trip has no bookings");

    signIn(shop, owner);
    await redirectedTo(() =>
      markPaymentAction(shop.slug, tripId, paymentForm(booking.id, "waived")),
    );

    signIn(shop, captain);
    const to = await redirectedTo(() =>
      markPaymentAction(shop.slug, tripId, paymentForm(booking.id, "waived")),
    );

    expect(to).not.toContain("not-authorized");
    expect((await getBookingPayment(db, shop.id, booking.id))?.status).toBe("waived");
  });

  it("lets a captain record counter cash but not write a seat off", async () => {
    const { db, shop, tripId, captain } = await context();
    signIn(shop, captain);
    const [booking] = await db.select().from(bookings).where(eq(bookings.tripId, tripId)).limit(1);
    if (!booking) throw new Error("seeded trip has no bookings");

    const form = (status: string) => {
      const data = new FormData();
      data.set("bookingId", booking.id);
      data.set("status", status);
      return data;
    };

    // Cash at the dock is front-desk work.
    const paid = await redirectedTo(() => markPaymentAction(shop.slug, tripId, form("paid")));
    expect(paid).not.toContain("notice=not-authorized");

    // A free seat is not.
    const waived = await redirectedTo(() => markPaymentAction(shop.slug, tripId, form("waived")));
    expect(waived).toContain("notice=not-authorized");

    // And `refunded` — which reduces reported revenue without moving money.
    const refunded = await redirectedTo(() =>
      markPaymentAction(shop.slug, tripId, form("refunded")),
    );
    expect(refunded).toContain("notice=not-authorized");
  });
});
