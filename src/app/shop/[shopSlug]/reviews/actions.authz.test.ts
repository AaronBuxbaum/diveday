import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { submitRecapPulse } from "@/db/recap-pulses";
import { bookings, recapPulses } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  demoteOwnerToManager,
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **Reading a private pulse is owner/manager work** (issue #1410).
 *
 * The moderation queue on `reviews/page.tsx` is public words and stays open to
 * every staff role. The "Asked us to fix" panel above it is not: it is the
 * diver's own sentence, under the diver's name, beside a link to their record,
 * and it frequently names crew. So the panel took an owner/manager boundary,
 * and marking a pulse addressed took it with them.
 *
 * The gate is `canReadPrivateRecapPulse`, the pulse's own predicate, rather
 * than the reports gate the panel first borrowed: the recap form promises the
 * diver a reader set in as many words, so widening revenue access must not
 * widen this (`src/lib/authz.test.ts` holds the sentence to the role set).
 *
 * The page hides the panel from everybody else, and hiding is not a gate — a
 * hand-made form post reaches the action all the same (ADR-0006). Nothing
 * below `markPulseAddressedAction` re-checks either: `markRecapPulseAddressed`
 * proves the *shop* owns the row and then writes whatever it is handed. So the
 * gate in the action is the only thing between a captain and somebody's
 * complaint, and these tests run the real action against a real seeded shop to
 * pin both halves of the refusal — the notice, and the pulse still open after.
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
const { markPulseAddressedAction } = await import("./actions");

/** The pulse row as the shop's panel would find it: open, or answered. */
async function pulseFor(db: AppDb, bookingId: string) {
  const [pulse] = await db
    .select({ id: recapPulses.id, addressedAt: recapPulses.addressedAt })
    .from(recapPulses)
    .where(eq(recapPulses.bookingId, bookingId));
  if (!pulse) throw new Error("the filed pulse is missing");
  return pulse;
}

/**
 * Seeded shop, one live pulse on one of its own bookings, and both actors,
 * with `getDb()` pointed at the same database the assertions read.
 *
 * The seed files no pulses of its own — nobody has complained to the demo shop
 * — so the fixture files one the way a diver does, through `submitRecapPulse`.
 */
async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), eq(bookings.status, "booked")))
    .orderBy(bookings.id)
    .limit(1);
  if (!booking) throw new Error("seeded shop has no live booking");
  const filed = await submitRecapPulse(db, {
    bookingId: booking.id,
    categories: ["gear"],
    note: "The second stage free-flowed all morning.",
  });
  if (!filed.ok) throw new Error(`pulse not filed: ${filed.reason}`);
  return {
    db,
    shop,
    bookingId: booking.id,
    pulse: await pulseFor(db, booking.id),
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

function withPulse(pulseId: string) {
  const formData = new FormData();
  formData.set("pulseId", pulseId);
  return formData;
}

describe("marking a private pulse addressed", () => {
  it("refuses a captain, and the pulse is still waiting afterwards", async () => {
    const { db, shop, bookingId, pulse, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => markPulseAddressedAction(withPulse(pulse.id)));

    expect(to).toBe(`/shop/${shop.slug}/reviews?notice=pulse-not-authorized`);
    // The refusal is only worth anything if the row survived it.
    expect((await pulseFor(db, bookingId)).addressedAt).toBeNull();
  });

  it("lets the owner answer it", async () => {
    const { db, shop, bookingId, pulse, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => markPulseAddressedAction(withPulse(pulse.id)));

    expect(to).toBe(`/shop/${shop.slug}/reviews?notice=pulse-addressed`);
    expect((await pulseFor(db, bookingId)).addressedAt).not.toBeNull();
  });

  it("lets a manager answer it, so this is not an owner-only gate", async () => {
    // The seed's only manager is also its owner, so the role has to be taken
    // off before a manager is a distinct person to test (`demoteOwnerToManager`).
    const { db, shop, bookingId, pulse, owner } = await context();
    await demoteOwnerToManager(db, owner);
    signIn(shop, owner);

    const to = await redirectedTo(() => markPulseAddressedAction(withPulse(pulse.id)));

    expect(to).toBe(`/shop/${shop.slug}/reviews?notice=pulse-addressed`);
    expect((await pulseFor(db, bookingId)).addressedAt).not.toBeNull();
  });

  it("refuses a captain carrying an inflated role list in their session", async () => {
    // A stale or forged JWT: the gate re-reads live roles from the database
    // rather than believing what the session claims.
    const { db, shop, bookingId, pulse, captain } = await context();
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: shop.id,
        shopSlug: shop.slug,
        personId: captain,
        roles: ["owner", "manager"],
      }),
    );

    const to = await redirectedTo(() => markPulseAddressedAction(withPulse(pulse.id)));

    expect(to).toBe(`/shop/${shop.slug}/reviews?notice=pulse-not-authorized`);
    expect((await pulseFor(db, bookingId)).addressedAt).toBeNull();
  });
});
