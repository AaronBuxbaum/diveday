import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { messageFor } from "@/lib/notifications/render";
import { seededShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { people, waiverRecords } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { sendGuardianReleaseCopy } from "./waiver-guardian-copy";
import { completeWaiver, issueWaiverRequest, recordInPersonWaiver } from "./waivers";

/**
 * **The guardian's copy of a release they co-signed** (issue #1453, owner
 * decision 2026-09-10).
 *
 * What these pin is mostly what the message does *not* carry. A parent gets a
 * record of a liability release with a named minor and a named shop on it, and
 * the issue rules out a bearer link to a third party by name — so "no `http`
 * anywhere in the rendered bytes" is the assertion that has to survive the next
 * edit, not a comment saying so.
 */
const now = new Date("2026-08-01T12:00:00.000Z");
const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((row) => row.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("demo trip missing");
  const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  // Twelve on the demo shop's calendar day at `now`, which is what turns the
  // co-signature rule on.
  await db
    .update(people)
    .set({ dateOfBirth: "2014-05-01" })
    .where(eq(people.id, rosterEntry.person.id));
  return { db, shop, booking: rosterEntry.booking, person: rosterEntry.person };
}

async function signOnline(
  ctx: Awaited<ReturnType<typeof context>>,
  guardianEmail: string,
): Promise<string> {
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.shop.id,
    bookingId: ctx.booking.id,
    now,
  });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  const outcome = await completeWaiver(ctx.db, issued.token, {
    signerName: ctx.person.fullName,
    agreed: true,
    medicalAnswers: clearAnswers,
    guardian: {
      name: "Jordan Fischer",
      relationship: "parent",
      email: guardianEmail,
      agreed: true,
    },
    now,
  });
  if (!outcome.ok) throw new Error(`sign failed: ${outcome.reason}`);
  return issued.recordId;
}

/**
 * The same signature with one health answer that needs a physician, which parks
 * the record in `medical_review`.
 */
async function signOnlineNeedingAPhysician(
  ctx: Awaited<ReturnType<typeof context>>,
  guardianEmail: string,
): Promise<string> {
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.shop.id,
    bookingId: ctx.booking.id,
    now,
  });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  // Picked by its own flag rather than by position: only a referral-flagged
  // question parks the record, and which one that is belongs to the
  // questionnaire, not to this test.
  const referral = RSTC_QUESTIONNAIRE.questions.find((question) => question.referral);
  if (!referral) throw new Error("questionnaire has no referral question");
  const outcome = await completeWaiver(ctx.db, issued.token, {
    signerName: ctx.person.fullName,
    agreed: true,
    medicalAnswers: {
      ...clearAnswers,
      responses: { ...clearAnswers.responses, [referral.id]: true },
    },
    guardian: {
      name: "Jordan Fischer",
      relationship: "parent",
      email: guardianEmail,
      agreed: true,
    },
    now,
  });
  if (!outcome.ok) throw new Error(`sign failed: ${outcome.reason}`);
  return issued.recordId;
}

describe("the guardian's copy of a signed release", () => {
  it("sends one copy carrying the release's facts and no link at all", async () => {
    const ctx = await context();
    const recordId = await signOnline(ctx, "jordan@example.com");
    const email = fakeEmail();

    expect(
      await sendGuardianReleaseCopy(
        ctx.db,
        { shopId: ctx.shop.id, recordId },
        { provider: email.provider },
      ),
    ).toEqual({ sent: true });

    expect(email.sent).toHaveLength(1);
    const [sent] = email.sent;
    if (!sent || sent.kind !== "guardian_release_copy") throw new Error("wrong kind sent");
    expect(sent.to).toBe("jordan@example.com");
    expect(sent.diverName).toBe(ctx.person.fullName);
    expect(sent.shopName).toBe(ctx.shop.name);
    // No address for the minor anywhere in the payload. It rode along in a
    // first cut so an erasure sweep could reach a queued copy; the copy is not
    // queued at all now, so the handle had no reader and the address is simply
    // not collected (`notificationIsQueueable`).
    expect(sent).not.toHaveProperty("diverEmail");

    // **The message itself.** Rendered rather than inspected as a payload,
    // because the thing being promised is what lands in a parent's inbox.
    const rendered = messageFor(sent);
    const body = `${rendered.subject}\n${rendered.text}\n${rendered.html}`;
    expect(body).not.toContain("http");
    expect(body).not.toContain("<a ");
    expect(rendered.text).toContain(ctx.person.fullName);
    // No medical answers: the questionnaire is the minor's own health
    // information and a courtesy copy to a third party is not where it goes.
    for (const question of RSTC_QUESTIONNAIRE.questions) {
      expect(body).not.toContain(question.id);
    }
  });

  /**
   * A `dive-domain-expert` pass on this layer found the copy telling a parent
   * "There is nothing to do and nothing to open" about a release parked in
   * `medical_review` — the one hold only that parent can clear, since they are
   * who takes the child to the physician. A 13-year-old ticks yes to the asthma
   * question in the car park, readiness raises a blocker nobody aboard can
   * clear, and the shop mails the responsible adult to say nothing is owed.
   */
  it("tells a parent what is owed when the release needs a physician", async () => {
    const ctx = await context();
    const recordId = await signOnlineNeedingAPhysician(ctx, "jordan@example.com");
    const email = fakeEmail();

    expect(
      await sendGuardianReleaseCopy(
        ctx.db,
        { shopId: ctx.shop.id, recordId },
        { provider: email.provider },
      ),
    ).toEqual({ sent: true });

    const [sent] = email.sent;
    if (!sent || sent.kind !== "guardian_release_copy") throw new Error("wrong kind sent");
    expect(sent.medicalReviewPending).toBe(true);

    const rendered = messageFor(sent);
    const body = `${rendered.subject}\n${rendered.text}\n${rendered.html}`;
    expect(rendered.text).toContain("physician");
    expect(body).not.toContain("nothing to do");
    // Still a courtesy copy: no link, no token, and no medical answer naming
    // which question was ticked.
    expect(body).not.toContain("http");
    for (const question of RSTC_QUESTIONNAIRE.questions) {
      expect(body).not.toContain(question.id);
    }
  });

  it("says nothing is owed when no physician is", async () => {
    const ctx = await context();
    const recordId = await signOnline(ctx, "jordan@example.com");
    const email = fakeEmail();
    await sendGuardianReleaseCopy(
      ctx.db,
      { shopId: ctx.shop.id, recordId },
      { provider: email.provider },
    );
    const [sent] = email.sent;
    if (!sent || sent.kind !== "guardian_release_copy") throw new Error("wrong kind sent");
    expect(sent.medicalReviewPending).toBe(false);
    expect(messageFor(sent).text).not.toContain("physician");
  });

  it("sends nothing when the family gave no address", async () => {
    const ctx = await context();
    // The grandparent case the form used to refuse outright (issue #1453).
    const recordId = await signOnline(ctx, "");
    const email = fakeEmail();

    expect(
      await sendGuardianReleaseCopy(
        ctx.db,
        { shopId: ctx.shop.id, recordId },
        { provider: email.provider },
      ),
    ).toEqual({ sent: false, reason: "no_guardian_email" });
    expect(email.sent).toEqual([]);

    // ...and the release itself is recorded, co-signed, with a null address.
    const [record] = await ctx.db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, recordId));
    expect(record).toMatchObject({ guardianName: "Jordan Fischer", guardianEmail: null });
    expect(record?.guardianSignedAt).not.toBeNull();
  });

  it("sends nothing for a paper record, which never collects an address", async () => {
    const ctx = await context();
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");
    const recorded = await recordInPersonWaiver(ctx.db, {
      shopId: ctx.shop.id,
      subject: { bookingId: ctx.booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      guardian: { name: "Jordan Fischer", relationship: "parent" },
      now,
    });
    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const email = fakeEmail();

    expect(
      await sendGuardianReleaseCopy(
        ctx.db,
        { shopId: ctx.shop.id, recordId: recorded.recordId },
        { provider: email.provider },
      ),
    ).toEqual({ sent: false, reason: "no_guardian_email" });
    expect(email.sent).toEqual([]);
  });

  it("refuses to read a record belonging to another shop", async () => {
    const ctx = await context();
    const recordId = await signOnline(ctx, "jordan@example.com");
    const email = fakeEmail();

    expect(
      await sendGuardianReleaseCopy(
        ctx.db,
        { shopId: "00000000-0000-4000-8000-00000000dead", recordId },
        { provider: email.provider },
      ),
    ).toEqual({ sent: false, reason: "not_found" });
    expect(email.sent).toEqual([]);
  });
});
