import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { accountSessions, rollCallEventClaims, userAccounts } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { listRetainedSafetyReviewEntries } from "./recovery";

vi.mock("./review-availability", () => ({ unresolvedReviewAvailable: () => true }));
const ctx = fileScopedShopContext();

it("pages existing retained entries without returning erased observation identities", async () => {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("trip fixture missing");
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, staffPersonId));
  if (!account) throw new Error("account fixture missing");
  const [session] = await db
    .insert(accountSessions)
    .values({
      userAccountId: account.id,
      personId: staffPersonId,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: ["owner"],
      name: "Staff",
      token: crypto.randomUUID(),
      expiresAt: new Date(nowDate().getTime() + 60_000),
    })
    .returning({ id: accountSessions.id });
  await db.insert(rollCallEventClaims).values(
    Array.from({ length: 51 }, () => ({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
      retainedSafetyEvidence: {
        version: 1 as const,
        receiptId: crypto.randomUUID(),
        checkpoint: "after_dive_1",
        status: "not_boarded",
        occurredAt: nowDate().toISOString(),
        meetingDay: null,
        observedEvidenceIds: null,
        retractsEventId: null,
        retractsClientEventId: null,
        reconcilesEvidence: false,
        noteRetained: false as const,
      },
    })),
  );
  const input = { shopId: shop.id, staffPersonId, sessionId: session.id, tripId: trip.id };
  const first = await listRetainedSafetyReviewEntries(db, input);
  expect(first.ok).toBe(true);
  if (!first.ok || !first.nextCursor) throw new Error("first page missing cursor");
  expect(first.entries).toHaveLength(50);
  expect(first.entries.every((entry) => entry.clientEventId === null)).toBe(true);
  const second = await listRetainedSafetyReviewEntries(db, {
    ...input,
    cursor: first.nextCursor,
    frontier: first.frontier,
  });
  expect(second).toEqual({
    ok: true,
    entries: [{ clientEventId: null }],
    nextCursor: null,
    frontier: first.frontier,
  });
  // This ID sorts before the first cursor. Continuing from the old frontier
  // must refuse, not silently omit the newly retained fact.
  await db.insert(rollCallEventClaims).values({
    id: "00000000-0000-0000-0000-000000000001",
    shopId: shop.id,
    tripId: trip.id,
    clientEventId: crypto.randomUUID(),
    state: "erased",
    retainedSafetyEvidence: {
      version: 1,
      receiptId: crypto.randomUUID(),
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: nowDate().toISOString(),
      meetingDay: null,
      observedEvidenceIds: null,
      retractsEventId: null,
      retractsClientEventId: null,
      reconcilesEvidence: false,
      noteRetained: false,
    },
  });
  expect(
    await listRetainedSafetyReviewEntries(db, {
      ...input,
      cursor: first.nextCursor,
      frontier: first.frontier,
    }),
  ).toEqual({ ok: false, reason: "review_changed" });
  expect(
    await listRetainedSafetyReviewEntries(db, { ...input, shopId: crypto.randomUUID() }),
  ).toEqual({ ok: false, reason: "forbidden" });
  await db.delete(accountSessions).where(eq(accountSessions.id, session.id));
  expect(await listRetainedSafetyReviewEntries(db, input)).toEqual({
    ok: false,
    reason: "forbidden",
  });
});
