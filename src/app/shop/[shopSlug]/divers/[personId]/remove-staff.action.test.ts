import { and, eq, gt, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { people, personRoles, tripAssignments, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **Removing someone who also works here** (dive-domain-expert, layer B
 * review). Removal now takes a person off every crew picker and away from
 * sign-in (`livePerson()`), but an assignment already on a boat stays where
 * it is, still counted on the manifest and toward the crew ratio. So Remove
 * refuses while they are crew on a departure still ahead, and the staffer
 * takes them off those boats first.
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
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { deletePersonAction } = await import("./record-actions");

async function dualRolePerson() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Ines Dual-Role", email: "ines.dual@example.invalid" })
    .returning({ id: people.id });
  if (!person) throw new Error("insert failed");
  await db.insert(personRoles).values([
    { personId: person.id, role: "diver" },
    { personId: person.id, role: "divemaster" },
  ]);
  return person.id;
}

async function anUpcomingTrip() {
  const [trip] = await ctx.db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, ctx.shop.id),
        isNull(trips.deletedAt),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, nowDate()),
      ),
    )
    .limit(1);
  if (!trip) throw new Error("seeded shop has no upcoming trip");
  return trip.id;
}

async function isRemoved(personId: string) {
  const [row] = await ctx.db
    .select({ deletedAt: people.deletedAt })
    .from(people)
    .where(eq(people.id, personId));
  return row?.deletedAt != null;
}

describe("removing a person who also holds a staff role", () => {
  it("refuses while they are crew on a departure still ahead", async () => {
    const personId = await dualRolePerson();
    await ctx.db.insert(tripAssignments).values({ tripId: await anUpcomingTrip(), personId });

    const to = await redirectedTo(() =>
      deletePersonAction(ctx.shop.slug, personId, new FormData()),
    );

    expect(to).toContain("notice=remove-crew-upcoming");
    expect(await isRemoved(personId)).toBe(false);
  });

  it("proceeds when they crew nothing ahead", async () => {
    const personId = await dualRolePerson();

    const to = await redirectedTo(() =>
      deletePersonAction(ctx.shop.slug, personId, new FormData()),
    );

    expect(to).toContain("notice=deleted");
    expect(await isRemoved(personId)).toBe(true);
  });
});
