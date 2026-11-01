import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { fileScopedShopContext } from "@/test/db";
import { getBookingReadiness } from "./readiness";
import { bookings, people, personRoles, userAccounts, waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { recordInPersonWaiver } from "./waivers-in-person";
import { issueWaiverRequest } from "./waivers-requests";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

describe("staff records a paper / in-person signature", () => {
  async function staffPerson(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("demo staff missing");
    return staff.person;
  }

  it("stores an immutable staff-attested record that clears the waiver gate", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const before = await getBookingReadiness(db, shop.id, booking.id);
    expect(before?.blockers).toContainEqual(expect.objectContaining({ code: "waiver_not_sent" }));

    const outcome = await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.id,
      medicalAttested: true,
      now,
    });
    expect(outcome).toMatchObject({ ok: true, alreadySigned: false });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    expect(record).toMatchObject({
      status: "completed",
      signatureMethod: "in_person_attested",
      recordedByPersonId: staff.id,
      personId: booking.personId,
      medicalReviewRequired: false,
    });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "waiver_not_sent" }),
    );
  });

  it("is idempotent — a booking already signed keeps its single record", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    const outcome = await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.id,
      medicalAttested: true,
      now,
    });
    expect(outcome).toMatchObject({ ok: true, alreadySigned: true });
    const rows = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    expect(rows.filter((row) => row.status === "completed")).toHaveLength(1);
  });

  it("retires a live pending link so its token can never complete a second record", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");

    await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.id,
      medicalAttested: true,
      now,
    });
    expect(await getWaiverForToken(db, issued.token, now)).toEqual({ state: "unavailable" });
  });

  it("refuses a recorder who is not shop staff, failing closed", async () => {
    const { db, shop, booking } = await waiverContext();
    // The booking's own diver is not staff, and a stranger id is not in the shop.
    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: booking.personId,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    const staff = await staffPerson(db, shop.id);
    expect(
      await recordInPersonWaiver(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toMatchObject({ ok: false });
  });

  /**
   * **A seat held over *whose* seat it is takes no attestation** (H-20260724-one-person-per-email,
   * `dive-domain-expert` review of issue #1696).
   *
   * This record is the strongest evidence in the product: a named staffer says
   * they watched this person sign, with the medical tick, and it lands on the
   * *matched* person's history — the record the flag exists to say the shop is
   * not sure about. Nothing later undoes that.
   *
   * Refused here rather than left to the surfaces. The counter only hides its
   * control because `identity` outranks `waiver` in `KIND_SEVERITY` and
   * `blockerFixFor` offers one fix at a time, and the roster's own
   * `PaperWaiverControl` never consulted the flag at all — so on the evidence
   * the property was resting on an integer in an unrelated table.
   */
  it("refuses a paper waiver on a seat whose identity is still unconfirmed", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.id));

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "identity_unconfirmed" });
    // Nothing written, so the seat still owes a release and the gate still holds.
    expect(
      await db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, booking.id)),
    ).toHaveLength(0);
    const readiness = await getBookingReadiness(db, shop.id, booking.id);
    expect(readiness?.blockers).toContainEqual(
      expect.objectContaining({ code: "identity_unconfirmed" }),
    );

    // …and the same tap lands the moment the shop says who this is.
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, booking.id));
    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toMatchObject({ ok: true });
  });

  /**
   * The diver's own record attests for a *person*, with no seat in sight, so
   * there is no guess to refuse — the release lands on the diver the caller
   * named. Pinned because the refusal above is one `select` away from being
   * written into `personSigner` too, where it would block the one door a
   * standing release is recorded through.
   */
  it("still records a diver's own paper release while a seat of theirs is held", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.id));

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { personId: booking.personId },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses to record a paper waiver without a medical-clear attestation", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: false,
        now,
      }),
    ).toEqual({ ok: false, reason: "medical_attestation_required" });
    // Nothing is written — the booking still needs a waiver.
    const rows = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    expect(rows).toHaveLength(0);
  });
});

/**
 * Security review of the live-roles work, following 40d0a09's fix to the three
 * roll-call writers in `src/db/manifests.ts`. This writer authorized its
 * attestor with the same hand-rolled `person_roles` join — `people.id` /
 * `people.shopId` / `person_roles.role` — and checked neither
 * `people.deleted_at` nor `user_accounts.status`. So the two cases
 * `loadActiveStaffRoles` exists for both got through:
 *
 * - a **deleted** person, because `deleteDiver` sets `people.deleted_at` and
 *   leaves every role row exactly where it is;
 * - a **disabled** account, because `setStaffAccountStatus` revokes sign-in and
 *   leaves `person_roles` entirely intact — a suspended employee keeps every
 *   role row they had, which is a role row outliving the person's standing by
 *   design rather than by oversight.
 *
 * What each bought is not a read: it is an immutable `waiver_records` row,
 * status `completed`, `signature_method` `in_person_attested`, stamped
 * `recorded_by_person_id`. That row is a signed medical and liability release
 * and the stamp is the shop's answer to "who watched this diver sign?" — a
 * document that may have to stand up outside the company, attributed to
 * somebody the shop had already removed. So the assertion that matters in every
 * test below is not the refusal code, it is that no record exists afterwards.
 *
 * The refusal stays the writer's existing `staff_not_found`: it is the same
 * answer to the same question, and both server actions above it
 * (`markRosterWaiverInPersonAction`, `markWaiverInPersonAction`) already fold it,
 * through `paperWaiverRefused`, into the form's own `error` refusal.
 */
describe("the in-person attestor must be live staff (defense in depth)", () => {
  async function liveStaff(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("demo staff missing");
    return staff.person;
  }

  /** Every release on file for this booking, whatever its status. */
  async function recordsFor(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    bookingId: string,
  ) {
    return db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, bookingId));
  }

  it("refuses a deleted person, and records no release in their name", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    // `deleteDiver`'s soft delete, which touches nothing but this column — the
    // staff roles that authorized them are all still sitting there.
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, staff.id));

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    // The outcome that matters. A refusal that still wrote the release would be
    // no fix at all: the row is the document, and it is immutable.
    expect(await recordsFor(db, booking.id)).toEqual([]);
  });

  it("refuses a disabled account still holding a stale role row, and records no release", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    // Access revoked, roster row intact — what `setStaffAccountStatus` leaves
    // behind. Sign-in already refuses this account; until now the writer did not.
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, staff.id));
    // The stale role row is the whole point of the case, so prove it is there
    // rather than assuming it.
    expect(
      await db.select().from(personRoles).where(eq(personRoles.personId, staff.id)),
    ).not.toEqual([]);

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    expect(await recordsFor(db, booking.id)).toEqual([]);
  });

  it("still lets live staff attest, and still refuses one demoted to diver", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    // The control for both refusals above: same shop, same booking, same call —
    // only the attestor's standing differs.
    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toMatchObject({ ok: true, alreadySigned: false });
    expect(await recordsFor(db, booking.id)).toMatchObject([
      { status: "completed", recordedByPersonId: staff.id },
    ]);

    // Demotion is the case the hand-rolled join did catch, and the rewrite must
    // keep catching it: every staff role gone, a `diver` row left. The gate runs
    // before the idempotency read, so the answer is the refusal rather than the
    // cheerful `alreadySigned` a signed booking would otherwise get.
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, staff.id), inArray(personRoles.role, [...STAFF_ROLES])));
    await db.insert(personRoles).values({ personId: staff.id, role: "diver" });

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    // Still just the one release the live staff member attested.
    expect(await recordsFor(db, booking.id)).toHaveLength(1);
  });

  it("leaves a live pending link signable when it refuses", async () => {
    // Adversarial: the writer retires any live pending link so its bearer token
    // cannot complete a second record. That happens *after* the staff gate, so
    // a refused attestation must leave the diver's own link exactly as it was —
    // a removed staff member must not be able to burn a diver's waiver link
    // just by tapping "signed on paper".
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, staff.id));

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    expect(await getWaiverForToken(db, issued.token, now)).toMatchObject({ state: "available" });
    expect((await recordsFor(db, booking.id)).map((row) => row.status)).toEqual(["pending"]);
  });
});
