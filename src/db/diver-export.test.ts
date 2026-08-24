import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { nowDate } from "@/lib/clock";
import { createWaiverToken, hashWaiverToken } from "@/lib/waiver-tokens";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { formBuddyTeam } from "./buddy-pairs";
import { canPersonExportShopData, loadDiverExportBundleInput } from "./export";
import { addDiverNote } from "./operations";
import { shops, userAccounts, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { getCurrentWaiverTemplate } from "./waivers";

async function personIdForEmail(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  email: string,
) {
  const [account] = await db
    .select({ personId: userAccounts.personId })
    .from(userAccounts)
    .where(eq(userAccounts.email, email))
    .limit(1);
  if (!account) throw new Error(`no account for ${email}`);
  return account.personId;
}

/** A party of two, so a lead/follower relationship and a shared buddy team both exist. */
async function partyOfTwo(
  shop: Awaited<ReturnType<typeof seededShopContext>>["shop"],
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
) {
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Adaeze Nwosu",
      email: "adaeze@example.com",
    },
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Chidi Okafor",
      email: "chidi@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const [lead, follower] = party.bookings;
  if (!lead || !follower) throw new Error("expected two bookings");
  return { tripId: reef.id, lead, follower };
}

/** A whole diver bundle, flattened to one string — the surface every "no leak" assertion reads. */
function serialize(
  input: NonNullable<Awaited<ReturnType<typeof loadDiverExportBundleInput>>>,
): string {
  return JSON.stringify(input);
}

describe("one diver's own record export (issue #726)", () => {
  it("scopes to the diver's own shop and person, and no one else's", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);

    // A real person id, but asked for under a shop it does not belong to.
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "A Different Shop", slug: "a-different-shop", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("second shop insert returned no row");

    expect(
      await loadDiverExportBundleInput(db, shop.id, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
    expect(await loadDiverExportBundleInput(db, otherShop.id, owner)).toBeNull();
  });

  it("never carries another diver's name or details, even from a shared party booking and buddy team", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    const { tripId, lead, follower } = await partyOfTwo(shop, db);

    // The follower's own booking carries the lead's booking id — a real,
    // ordinary cross-reference to a different diver's row.
    const followerInput = await loadDiverExportBundleInput(db, shop.id, follower.personId);
    if (!followerInput) throw new Error("follower export failed to load");
    const bookingsTable = followerInput.tables.find((t) => t.file === "bookings.csv");
    if (!bookingsTable) throw new Error("bookings.csv missing");
    // party_lead_booking_id is not a column at all — see loadDiverExportBundleInput's
    // own doc comment on why it is blanked rather than carried through.
    expect(bookingsTable.header).not.toContain("party_lead_booking_id");

    await formBuddyTeam(db, {
      shopId: shop.id,
      tripId,
      members: [
        { kind: "diver", bookingId: lead.bookingId },
        { kind: "diver", bookingId: follower.bookingId },
      ],
      recordedByPersonId: owner,
    });

    // A note on the lead's own record that names the follower by name — the
    // shape anonymize.ts's own erasure sweep exists to catch, here proving the
    // export never carries it in the first place because the whole file is
    // excluded.
    await addDiverNote(db, {
      shopId: shop.id,
      personId: lead.personId,
      actorPersonId: owner,
      body: `${follower.personName} asked to switch buddy teams before we left the dock.`,
    });

    const leadInput = await loadDiverExportBundleInput(db, shop.id, lead.personId);
    if (!leadInput) throw new Error("lead export failed to load");

    // The excluded-outright files never appear in the bundle at all.
    const files = leadInput.tables.map((t) => t.file);
    expect(files).not.toContain("internal_notes.csv");
    expect(files).not.toContain("activity_events.csv");
    expect(files).not.toContain("booking_checkouts.csv");

    // The buddy team is included, but only the lead's own membership row.
    const buddyTable = leadInput.tables.find((t) => t.file === "buddy_pairs.csv");
    if (!buddyTable) throw new Error("buddy_pairs.csv missing");
    expect(buddyTable.rows).toHaveLength(1);

    // And nowhere in the whole bundle — not a stray id, not a name slipped
    // into a denormalized column — does the other diver's name appear.
    expect(serialize(leadInput)).not.toContain(follower.personName);
  });

  it("withholds medical answers from a signed waiver but keeps every other field", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    const { follower } = await partyOfTwo(shop, db);
    const template = await getCurrentWaiverTemplate(db, shop.id);
    if (!template) throw new Error("demo shop has no waiver template");

    const token = createWaiverToken();
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      bookingId: follower.bookingId,
      personId: follower.personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "completed",
      tokenHash: hashWaiverToken(token),
      expiresAt: new Date(nowDate().getTime() + 60 * 60 * 1000),
      signedName: follower.personName,
      signatureMethod: "typed_consent",
      consentedAt: nowDate(),
      signedAt: nowDate(),
      completedAt: nowDate(),
      medicalAnswers: {
        questionnaireId: "padi-2026",
        questionnaireVersion: 1,
        responses: { "has-asthma-diagnosis-requiring-a-secret-clinic-referral": true },
      },
      recordedByPersonId: owner,
    });

    const input = await loadDiverExportBundleInput(db, shop.id, follower.personId);
    if (!input) throw new Error("export failed to load");
    const records = input.tables.find((t) => t.file === "waiver_records.csv");
    if (!records) throw new Error("waiver_records.csv missing");

    expect(records.header).not.toContain("medical_answers");
    expect(serialize(input)).not.toContain("secret-clinic-referral");

    // Everything else about the diver's own signature is still there.
    expect(records.header).toContain("signed_name");
    expect(records.header).toContain("signature_method");
    expect(records.header).toContain("recorded_by_name");
    const row = records.rows.find((candidate) => candidate[records.header.indexOf("id")]);
    expect(row?.[records.header.indexOf("status")]).toBe("completed");
    expect(row?.[records.header.indexOf("recorded_by_name")]).toBeTruthy();
  });

  it("resolves a staff name onto a roll-call event without naming any other diver", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    const { lead } = await partyOfTwo(shop, db);

    const input = await loadDiverExportBundleInput(db, shop.id, lead.personId);
    if (!input) throw new Error("export failed to load");
    const profile = input.tables.find((t) => t.file === "profile.csv");
    if (!profile) throw new Error("profile.csv missing");
    expect(profile.rows).toHaveLength(1);
    expect(profile.rows[0]?.[profile.header.indexOf("full_name")]).toBe(lead.personName);
    // The gate this route enforces — proven directly rather than through HTTP.
    expect(await canPersonExportShopData(db, shop.id, owner)).toBe(true);
  });
});
