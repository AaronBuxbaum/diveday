import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, userAccounts } from "@/db/schema";
import { STAFF_ROLES } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The diver record holds the two most consequential buttons in the product:
 * "Refund" moves money out, and "Erase" destroys identifying and medical data
 * one way. `divers/[personId]/page.tsx` hides each from the roles that may not
 * use it, but hiding is a courtesy — a form post reaches the action regardless,
 * which is exactly what ADR-0006 says a UI check is never allowed to be the only
 * layer. Each test below runs the real action against a real seeded shop and
 * asserts both the refusal notice and that the row is as it was.
 *
 * Erasure has a *second* gate underneath: `anonymizeDiver` re-runs
 * `canPersonErasePersonalData` inside its own transaction (src/db/anonymize.ts),
 * because "the route forgot to check" has no remedy for a one-way write. The
 * action-level gate tested here is the first of the two, and the one that
 * produces the notice staff actually see — deleting it turns these tests red on
 * the notice (`erase-refused` instead of `not-authorized-erase`) while the diver's
 * data survives, which is precisely what defense in depth is supposed to look
 * like. Refund and removal have no such second layer: `refundOrder` and
 * `deleteDiver` write whatever they are handed, so for those two the assertions
 * below are the only thing standing behind the gate line.
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
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// The one write that leaves the database — `refundOrder` calls Stripe. Mocked so
// the refusal tests can assert the money never moved, at the seam it moves
// through; the rest of the module stays real (the erase path reads orders).
vi.mock("@/db/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/orders")>();
  return { ...actual, refundOrder: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { refundOrder } = await import("@/db/orders");
const { deletePersonAction, erasePersonAction, refundPaymentAction } = await import("./actions");

/**
 * A seeded diver — someone with no *staff* role. `anonymizeDiver` refuses to
 * erase a staff member outright, so picking one would test the wrong refusal.
 */
async function seededDiverId(db: AppDb, shopId: string): Promise<string> {
  const staffIds = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .where(inArray(personRoles.role, [...STAFF_ROLES]))
    .then((rows) => rows.map((row) => row.personId));
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        staffIds.length > 0 ? notInArray(people.id, staffIds) : undefined,
      ),
    )
    .orderBy(people.fullName)
    .limit(1);
  if (!diver) throw new Error("seeded shop has no non-staff diver");
  return diver.id;
}

/** A manager who is *not* an owner — the role that separates "remove" from "erase". */
async function makeManager(db: AppDb, shopId: string): Promise<string> {
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: "Morgan Manager", email: "morgan.manager@demo.invalid" })
    .returning();
  if (!person) throw new Error("failed to insert manager");
  await db.insert(personRoles).values({ personId: person.id, role: "manager" });
  await db.insert(userAccounts).values({
    personId: person.id,
    email: "morgan.manager@demo.invalid",
    hashedPassword: "x",
    status: "active",
  });
  return person.id;
}

async function personRow(db: AppDb, personId: string) {
  const [row] = await db.select().from(people).where(eq(people.id, personId));
  if (!row) throw new Error("person vanished");
  return row;
}

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    diver: await seededDiverId(db, shop.id),
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refunding a diver's payment", () => {
  it("refuses a captain — money out is owner/manager work", async () => {
    const { shop, diver, captain } = await context();
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("orderId", "11111111-1111-4111-8111-111111111111");

    const to = await redirectedTo(() => refundPaymentAction(shop.slug, diver, formData));

    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=not-authorized-refund`);
    // Nothing reached Stripe: the gate runs before the order is even looked up.
    expect(refundOrder).not.toHaveBeenCalled();
  });

  it("lets an owner through to the refund itself", async () => {
    const { shop, diver, owner } = await context();
    signIn(shop, owner);
    vi.mocked(refundOrder).mockResolvedValue(true as never);
    const orderId = "11111111-1111-4111-8111-111111111111";
    const formData = new FormData();
    formData.set("orderId", orderId);

    const to = await redirectedTo(() => refundPaymentAction(shop.slug, diver, formData));

    // The seeded shop is a demo tenant, whose orders carry fabricated Stripe
    // ids — the action stops at that guard, *after* the role gate. A captain
    // never reaches this notice, which is the point: the two refusals are
    // distinguishable, and only one of them is about authorization.
    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=demo-disabled`);
  });
});

describe("removing a diver from the roster", () => {
  it("refuses a captain and leaves the person on the roster", async () => {
    const { db, shop, diver, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => deletePersonAction(shop.slug, diver, new FormData()));

    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=not-authorized-delete`);
    expect((await personRow(db, diver)).deletedAt).toBeNull();
  });

  it("lets an owner remove the diver", async () => {
    const { db, shop, diver, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => deletePersonAction(shop.slug, diver, new FormData()));

    expect(to).toBe(
      `/shop/${shop.slug}/divers?notice=deleted&deleted=${encodeURIComponent(diver)}`,
    );
    expect((await personRow(db, diver)).deletedAt).not.toBeNull();
  });
});

describe("erasing a diver's personal and medical data", () => {
  it("refuses a captain, and their name is still on the record afterwards", async () => {
    const { db, shop, diver, captain } = await context();
    const before = await personRow(db, diver);
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("confirmName", before.fullName);

    const to = await redirectedTo(() => erasePersonAction(shop.slug, diver, formData));

    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=not-authorized-erase`);
    const after = await personRow(db, diver);
    expect(after.fullName).toBe(before.fullName);
    expect(after.anonymizedAt).toBeNull();
  });

  it("refuses a manager too — erasure is owner-only, stricter than removal", async () => {
    // The gate that separates the two buttons on the same card: a manager may
    // take a diver off the roster (reversible) but may not make the shop's own
    // record of them unrecoverable (ADR 20260802-diver-data-erasure).
    const { db, shop, diver } = await context();
    const manager = await makeManager(db, shop.id);
    const before = await personRow(db, diver);
    signIn(shop, manager);
    const formData = new FormData();
    formData.set("confirmName", before.fullName);

    const to = await redirectedTo(() => erasePersonAction(shop.slug, diver, formData));

    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=not-authorized-erase`);
    expect((await personRow(db, diver)).anonymizedAt).toBeNull();
  });

  it("lets an owner erase, once they have typed the diver's name back", async () => {
    const { db, shop, diver, owner } = await context();
    const before = await personRow(db, diver);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("confirmName", before.fullName);

    const to = await redirectedTo(() => erasePersonAction(shop.slug, diver, formData));

    expect(to).toMatch(new RegExp(`^/shop/${shop.slug}/divers\\?notice=erased`));
    const after = await personRow(db, diver);
    expect(after.anonymizedAt).not.toBeNull();
    expect(after.fullName).not.toBe(before.fullName);
  });
});
