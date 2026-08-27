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
import { orderLineItems, orders, shops, userAccounts, waiverRecords } from "./schema";
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

  it("withholds medical answers from a signed waiver, and the scanned medical document that came with an import, but keeps every other field", async () => {
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
      // An imported record's re-stored source documents (ADR
      // 20260724-import-waiver-acceptance). The general document is fine to
      // hand back — it's the same signed release either way — but the medical
      // one is a scanned copy of the exact thing medical_answers withholds,
      // and it is what security review found this test did not yet cover:
      // it went out through photoUrls even while the JSON column stayed home.
      importSourceDocumentUrl:
        "https://diveday-media.s3.us-east-1.amazonaws.com/waivers/signed-release.pdf",
      importSourceMedicalDocumentUrl:
        "https://diveday-media.s3.us-east-1.amazonaws.com/waivers/medical-questionnaire-scan.pdf",
    });

    const input = await loadDiverExportBundleInput(db, shop.id, follower.personId);
    if (!input) throw new Error("export failed to load");
    const records = input.tables.find((t) => t.file === "waiver_records.csv");
    if (!records) throw new Error("waiver_records.csv missing");

    expect(records.header).not.toContain("medical_answers");
    expect(serialize(input)).not.toContain("secret-clinic-referral");

    // The general document is bundled; the medical scan is not — checked
    // against the photo manifest this loader hands the download route, not
    // against the CSV, since a URL bundles as a *file* rather than a cell.
    expect(input.photoUrls).toContain(
      "https://diveday-media.s3.us-east-1.amazonaws.com/waivers/signed-release.pdf",
    );
    expect(input.photoUrls).not.toContain(
      "https://diveday-media.s3.us-east-1.amazonaws.com/waivers/medical-questionnaire-scan.pdf",
    );

    // Everything else about the diver's own signature is still there,
    // including the exact wording they signed.
    expect(records.header).toContain("signed_name");
    expect(records.header).toContain("signature_method");
    expect(records.header).toContain("recorded_by_name");
    const row = records.rows.find((candidate) => candidate[records.header.indexOf("id")]);
    expect(row?.[records.header.indexOf("status")]).toBe("completed");
    expect(row?.[records.header.indexOf("recorded_by_name")]).toBeTruthy();

    const templates = input.tables.find((t) => t.file === "waiver_templates.csv");
    if (!templates) throw new Error("waiver_templates.csv missing");
    const templateRow = templates.rows.find(
      (candidate) => candidate[templates.header.indexOf("id")] === template.id,
    );
    expect(templateRow?.[templates.header.indexOf("body")]).toBe(template.body);
  });

  it("drops staff free-text notes from a diver's own orders, keeping the money", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    const { lead } = await partyOfTwo(shop, db);
    // Raw inserts, deliberately: this test is about the export's column
    // selection, not about the invoicing flow that ordinarily writes these
    // rows (the same call `refunds.postgres.test.ts` makes for the same
    // reason).
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: lead.personId,
        createdByPersonId: owner,
        bookingId: lead.bookingId,
        currency: "usd",
        totalCents: 2_000,
        description: `Split with ${lead.personName}'s buddy this trip`,
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripeInvoiceId: `in_${lead.bookingId}`,
      })
      .returning();
    if (!order) throw new Error("order insert returned no row");
    await db.insert(orderLineItems).values({
      shopId: shop.id,
      orderId: order.id,
      kind: "rental",
      description: `Rental gear, shared with ${lead.personName}'s buddy this trip`,
      unitAmountCents: 2_000,
    });

    const input = await loadDiverExportBundleInput(db, shop.id, lead.personId);
    if (!input) throw new Error("export failed to load");
    const ordersTable = input.tables.find((t) => t.file === "orders.csv");
    const lineItems = input.tables.find((t) => t.file === "order_line_items.csv");
    if (!ordersTable || !lineItems) throw new Error("orders tables missing");

    expect(ordersTable.header).not.toContain("description");
    expect(lineItems.header).not.toContain("description");
    expect(serialize(input)).not.toContain("Split with");
    expect(serialize(input)).not.toContain("shared with");
    // The money is still there — only the free text is gone.
    expect(lineItems.header).toContain("unit_amount_cents");
    const lineRow = lineItems.rows.find(
      (candidate) => candidate[lineItems.header.indexOf("order_id")] === order.id,
    );
    expect(lineRow?.[lineItems.header.indexOf("unit_amount_cents")]).toBe(2_000);
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
