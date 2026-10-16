import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { INVITE_SUGGESTIONS_SHOWN } from "@/lib/invite-suggestions";
import { fileScopedShopContext } from "@/test/db";
import { invitedWithinCooldown, listInviteSuggestions } from "./invite-suggestions";
import { bookings, diveSites, people, personRoles, tripInvitations, trips } from "./schema";

const ctx = fileScopedShopContext();

async function fixture() {
  const { db, shop } = ctx;
  const now = nowDate();
  const [site] = await db
    .insert(diveSites)
    .values({ shopId: shop.id, name: "Invite Test Wall", slug: "invite-test-wall" })
    .returning();
  const trip = async (title: string, startsAt: Date, isRehearsal = false) => {
    const [row] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 12,
        diveSiteId: site.id,
        isRehearsal,
        isPrivate: isRehearsal,
      })
      .returning();
    return row;
  };
  const target = await trip("Next wall dive", new Date(now.getTime() + 10 * DAY_MS));
  const march = await trip("Wall in March", new Date(now.getTime() - 200 * DAY_MS));
  const july = await trip("Wall in July", new Date(now.getTime() - 90 * DAY_MS));
  const rehearsal = await trip("Wall rehearsal", new Date(now.getTime() - 30 * DAY_MS), true);

  const diver = async (fullName: string, extra: Partial<typeof people.$inferInsert> = {}) => {
    const [row] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName,
        email: `${fullName.toLowerCase().replaceAll(" ", ".")}@invite-test.example`,
        ...extra,
      })
      .returning();
    await db.insert(personRoles).values({ personId: row.id, role: "diver" });
    return row;
  };
  const seat = (tripId: string, personId: string, status: "booked" | "cancelled" | "no_show" = "booked") =>
    db.insert(bookings).values({ bookedAs: "diver", shopId: shop.id, tripId, personId, status });

  return { db, shop, now, site, target, march, july, rehearsal, diver, seat };
}

describe("listInviteSuggestions", () => {
  it("lists past divers of the site, most recent first, with when they last came", async () => {
    const { db, shop, now, target, march, july, diver, seat } = await fixture();
    const nadia = await diver("Nadia Petrov");
    const ines = await diver("Ines Costa");
    await seat(march.id, nadia.id);
    await seat(july.id, ines.id);

    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.siteName).toBe("Invite Test Wall");
    expect(got?.shown.map((p) => p.fullName)).toEqual(["Ines Costa", "Nadia Petrov"]);
    expect(got?.shown[0].lastDivedAt).toEqual(july.startsAt);
    expect(got?.total).toBe(2);
  });

  it("leaves out anyone aboard, already invited here, or invited anywhere in the last 30 days", async () => {
    const { db, shop, now, target, march, diver, seat } = await fixture();
    const aboard = await diver("Already Aboard");
    const invitedHere = await diver("Invited Here");
    const invitedRecently = await diver("Invited Recently");
    const invitedLongAgo = await diver("Invited Long Ago");
    for (const p of [aboard, invitedHere, invitedRecently, invitedLongAgo]) await seat(march.id, p.id);
    await seat(target.id, aboard.id);
    await db.insert(tripInvitations).values([
      { shopId: shop.id, tripId: target.id, source: "direct", personId: invitedHere.id, createdByPersonId: aboard.id },
      {
        shopId: shop.id,
        tripId: march.id,
        source: "direct",
        personId: invitedRecently.id,
        createdByPersonId: aboard.id,
        invitedAt: new Date(now.getTime() - 29 * DAY_MS),
      },
      {
        shopId: shop.id,
        tripId: march.id,
        source: "direct",
        personId: invitedLongAgo.id,
        createdByPersonId: aboard.id,
        invitedAt: new Date(now.getTime() - 31 * DAY_MS),
      },
    ]);

    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown.map((p) => p.fullName)).toEqual(["Invited Long Ago"]);
    expect(await invitedWithinCooldown(db, shop.id, invitedRecently.id, now)).toBe(true);
    expect(await invitedWithinCooldown(db, shop.id, invitedLongAgo.id, now)).toBe(false);
  });

  it("leaves out the erased, the opted out, the addressless, no-shows and rehearsals", async () => {
    const { db, shop, now, target, march, rehearsal, diver, seat } = await fixture();
    const erased = await diver("Erased Diver", { anonymizedAt: now, deletedAt: now });
    const optedOut = await diver("Opted Out", { courtesyEmailOptOutAt: now });
    const noEmail = await diver("No Email", { email: null });
    const noShow = await diver("No Show");
    const cancelled = await diver("Cancelled Seat");
    const rehearsed = await diver("Only Rehearsed");
    for (const p of [erased, optedOut, noEmail]) await seat(march.id, p.id);
    await seat(march.id, noShow.id, "no_show");
    await seat(march.id, cancelled.id, "cancelled");
    await seat(rehearsal.id, rehearsed.id);

    expect(await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now })).toBeNull();
  });

  it("shows a handful and counts the rest", async () => {
    const { db, shop, now, target, march, diver, seat } = await fixture();
    for (let i = 0; i < INVITE_SUGGESTIONS_SHOWN + 3; i++) {
      await seat(march.id, (await diver(`Past Diver ${String(i).padStart(2, "0")}`)).id);
    }
    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown).toHaveLength(INVITE_SUGGESTIONS_SHOWN);
    expect(got?.total).toBe(INVITE_SUGGESTIONS_SHOWN + 3);
  });
});
