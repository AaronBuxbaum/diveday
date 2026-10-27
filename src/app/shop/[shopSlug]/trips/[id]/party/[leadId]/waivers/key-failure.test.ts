import { and, eq, inArray } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { issuePartyWaiver } from "@/db/party-waiver-queue";
import { people, personRoles } from "@/db/schema";
import { seatParty } from "@/db/seat-diver";
import { upcomingTripsWithCounts } from "@/db/trips";
import { getWaiverForToken, saveWaiverDraft } from "@/db/waivers-completion";
import { clearAnswers } from "@/db/waivers-test-fixtures";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/notifications/app-url", () => ({ publicAppUrl: () => "https://diveday.test" }));
const { requireShopSurface } = await import("@/lib/session");
const { issuePartyWaiverQrAction } = await import("./actions");
const ctx = fileScopedShopContext();
afterEach(() => vi.unstubAllEnvs());

it("leaves the existing link and draft intact when QR sealing is unavailable", async () => {
  vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (item) => item.title === "Two-Tank Reef — Christ of the Abyss",
  );
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!trip || !staff) throw new Error("fixture missing");
  const party = await seatParty(db, {
    shopId: shop.id,
    tripId: trip.id,
    actorPersonId: staff.id,
    entry: "walk_in",
    refusals: "specific",
    members: [{ fullName: `Sealing Test ${crypto.randomUUID()}`, minor: false }],
  });
  if (!party.ok || !party.seats[0]) throw new Error("seat missing");
  const bookingId = party.seats[0].bookingId;
  const issued = await issuePartyWaiver(db, {
    shopId: shop.id,
    tripId: trip.id,
    leadBookingId: bookingId,
    bookingId,
  });
  if (!issued) throw new Error("link missing");
  expect(
    await saveWaiverDraft(db, issued.token, {
      signerName: "Draft in progress",
      acknowledged: false,
      medicalAnswers: clearAnswers,
    }),
  ).toBe(true);
  vi.mocked(requireShopSurface).mockResolvedValue({ db, shop } as never);
  vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
  expect(await issuePartyWaiverQrAction(shop.slug, trip.id, bookingId, bookingId)).toEqual({
    ok: false,
  });
  const state = await getWaiverForToken(db, issued.token);
  expect(state).toMatchObject({
    state: "available",
    record: { draftSignerName: "Draft in progress" },
  });
});
