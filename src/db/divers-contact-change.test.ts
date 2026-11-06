import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { prepareContactImport } from "@/test/import-fixture";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { commitContactImport } from "@/test/words-wiring";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { mergeDiverRecords } from "./diver-merge";
import { createDiver, editDiver } from "./divers";
import { waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { issueAndDeliverPersonWaiver, issueAndDeliverWaiver } from "./waiver-issue";
import { completeWaiver, getWaiverForToken, recordWaiverDraft } from "./waivers-completion";
import { attachDiverMedicalForm, doctorPageOpen, revealDoctorReferral } from "./waivers-medical";
import { issueWaiverRequest } from "./waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  recordMedicalEvaluationForShop,
} from "./waivers-test-fixtures";

/**
 * **A corrected address takes the old links with it** (#3902). A delivered
 * booking link went to the email or phone on file; when staff change that
 * contact (a typo fixed), whoever holds the old address must not keep a live
 * link. The next send mints a fresh one to the new address. A link the
 * browser was handed (undelivered) is not about the address and stays.
 */
const ctx = fileScopedShopContext();

async function seatedDiver(suffix: string) {
  const { db, shop } = ctx;
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: `Contact Change ${suffix}`,
    email: `contact-change-${suffix}@example.com`,
    phone: "+1 305 555 0170",
  });
  if (!diver) throw new Error("diver insert failed");
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => !candidate.course && candidate.capacity > candidate.booked,
  );
  if (!trip) throw new Error("open trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    personId: diver.id,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  const delivered = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    purpose: "readiness",
    delivered: true,
  });
  const handed = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    purpose: "readiness",
  });
  if (!delivered || !handed) throw new Error("links missing");
  const waiver = await issueWaiverRequest(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    now: nowDate(),
  });
  if (!waiver.ok) throw new Error(`waiver issue failed: ${waiver.reason}`);
  return {
    db,
    shop,
    diver,
    bookingId: booking.bookingId,
    delivered: delivered.token,
    handed: handed.token,
    waiver: waiver.token,
  };
}

const live = (token: string) =>
  verifyBookingCapability(ctx.db, { token, purpose: "readiness" }).then(Boolean);

describe("changing a diver's contact revokes their delivered links (#3902)", () => {
  it("revokes on an email change", async () => {
    const { db, shop, diver, delivered, handed } = await seatedDiver("email");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: "contact-change-fixed@example.com",
      phone: "+1 305 555 0170",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect(await live(handed)).toBe(true);
  });

  it("revokes on a phone change", async () => {
    const { db, shop, diver, delivered, handed } = await seatedDiver("phone");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: `contact-change-phone@example.com`,
      phone: "+1 305 555 0171",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect(await live(handed)).toBe(true);
  });

  it("keeps the links when the save leaves both unchanged, however they were typed", async () => {
    const { db, shop, diver, delivered } = await seatedDiver("same");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Renamed Only",
      email: "  Contact-Change-Same@Example.com ",
      phone: "305.555.0170",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(true);
  });

  it("supersedes the unsigned waiver sent to the old address, so a re-send is a new link", async () => {
    const { db, shop, diver, bookingId, waiver } = await seatedDiver("waiver");
    expect((await getWaiverForToken(db, waiver)).state).toBe("available");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: "contact-change-waiver-fixed@example.com",
      phone: "+1 305 555 0170",
    });
    expect(result.ok).toBe(true);
    expect((await getWaiverForToken(db, waiver)).state).toBe("unavailable");
    const again = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now: nowDate() });
    if (!again.ok) throw new Error(`re-send failed: ${again.reason}`);
    expect(again.token).not.toBe(waiver);
    expect((await getWaiverForToken(db, again.token)).state).toBe("available");
  });

  it("keeps the unsigned waiver when the save leaves the contact alone", async () => {
    const { db, shop, diver, waiver } = await seatedDiver("waiver-same");
    await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Renamed Waiver Diver",
      email: diver.email ?? "",
      phone: "+1 305 555 0170",
    });
    expect((await getWaiverForToken(db, waiver)).state).toBe("available");
  });
});

describe("other writes that change a diver's contact revoke the same links (#3902)", () => {
  it("a merge that takes the other record's email", async () => {
    const { db, shop, diver, delivered, waiver } = await seatedDiver("merge-survivor");
    const source = await createDiver(db, {
      shopId: shop.id,
      fullName: diver.fullName,
      email: "contact-change-merge-source@example.com",
    });
    if (!source) throw new Error("source insert failed");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const result = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: diver.id,
      actorPersonId: owner,
      choices: { email: "source" },
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect((await getWaiverForToken(db, waiver)).state).toBe("unavailable");
  });

  it("a contacts import that overwrites the phone", async () => {
    const { db, shop, diver, delivered, waiver } = await seatedDiver("import");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const csv = `full_name,email,phone\n${diver.fullName},${diver.email},+1 305 555 0179\n`;
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), owner);
    expect(summary.peopleUpdated).toBe(1);
    expect(await live(delivered)).toBe(false);
    expect((await getWaiverForToken(db, waiver)).state).toBe("unavailable");
  });

  it("a contacts import that carries the same phone leaves the links alone", async () => {
    const { db, shop, diver, delivered } = await seatedDiver("import-same");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const csv = `full_name,email,phone\n${diver.fullName},${diver.email},+1 305 555 0170\n`;
    await commitContactImport(db, shop.id, prepareContactImport(csv), owner);
    expect(await live(delivered)).toBe(true);
  });
});

/**
 * **Issue #3950, through the sends staff actually use.** A seat's release now
 * goes out as the holder's thread link (ADR 20261105-waiver-folds-into-the-thread)
 * and a bookingless release as its waiver link; a corrected address must
 * leave neither open for whoever holds the old one, and the next send must
 * be a different URL, to the new address only. A signed release is evidence
 * and never changes.
 */
describe("a corrected address retires the waiver it was sent (#3950)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const urlOf = (sent: Notification[], at: number) => {
    const message = sent[at];
    if (message?.kind !== "waiver_request") throw new Error(`no waiver mail ${at}`);
    return { to: message.to, url: message.completionUrl };
  };
  const threadToken = (url: string) => /\/ready\/([^/]+)\/waiver$/.exec(url)?.[1] ?? null;
  const waiverToken = (url: string) => /\/waivers\/([^/]+)$/.exec(url)?.[1] ?? null;
  const fixEmail = (diver: { id: string; fullName: string }, email: string) =>
    editDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email,
      phone: "+1 305 555 0170",
    });

  it("a seat: the re-sent thread link differs, and the old one no longer opens", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, diver, bookingId } = await seatedDiver("seat-resend");
    const mail = fakeEmail();

    const first = await issueAndDeliverWaiver(db, shop.id, bookingId, { provider: mail.provider });
    expect(first).toMatchObject({ ok: true, delivery: "sent" });
    const before = urlOf(mail.sent, 0);
    const oldToken = threadToken(before.url);
    if (!oldToken) throw new Error(`not a thread link: ${before.url}`);
    expect(await live(oldToken)).toBe(true);

    expect((await fixEmail(diver, "seat-resend-fixed@example.com")).ok).toBe(true);
    expect(await live(oldToken)).toBe(false);

    const again = await issueAndDeliverWaiver(db, shop.id, bookingId, { provider: mail.provider });
    expect(again).toMatchObject({ ok: true, delivery: "sent" });
    const after = urlOf(mail.sent, 1);
    expect(after.to).toBe("seat-resend-fixed@example.com");
    expect(after.url).not.toBe(before.url);
    const newToken = threadToken(after.url);
    if (!newToken) throw new Error(`not a thread link: ${after.url}`);
    expect(await live(newToken)).toBe(true);
    expect(await live(oldToken)).toBe(false);
  });

  it("a bookingless release: the emailed and copied link dies, and the re-send is a new URL", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, diver } = await seatedDiver("person-resend");
    const mail = fakeEmail();

    await issueAndDeliverPersonWaiver(db, shop.id, diver.id, { provider: mail.provider });
    const copied = await issueAndDeliverPersonWaiver(db, shop.id, diver.id, { channel: "link" });
    const before = urlOf(mail.sent, 0);
    const oldToken = waiverToken(before.url);
    if (!oldToken || !copied.ok) throw new Error("no waiver link");
    // Copy link and the email are one URL (ADR 20260820-waiver-links-are-reused-not-reissued).
    expect(copied.token).toBe(oldToken);
    expect((await getWaiverForToken(db, oldToken)).state).toBe("available");

    expect((await fixEmail(diver, "person-resend-fixed@example.com")).ok).toBe(true);

    expect((await getWaiverForToken(db, oldToken)).state).toBe("unavailable");
    const signing = { signerName: diver.fullName, agreed: true, medicalAnswers: clearAnswers };
    expect(await completeWaiver(db, oldToken, signing)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(
      await recordWaiverDraft(db, oldToken, {
        signerName: diver.fullName,
        acknowledged: true,
        medicalAnswers: medicalReferralAnswers,
      }),
    ).toBe(false);

    await issueAndDeliverPersonWaiver(db, shop.id, diver.id, { provider: mail.provider });
    const after = urlOf(mail.sent, 1);
    expect(after.to).toBe("person-resend-fixed@example.com");
    const newToken = waiverToken(after.url);
    if (!newToken) throw new Error(`not a waiver link: ${after.url}`);
    expect(newToken).not.toBe(oldToken);
    expect((await getWaiverForToken(db, newToken)).state).toBe("available");
    expect((await getWaiverForToken(db, oldToken)).state).toBe("unavailable");
  });

  it("what the old address typed does not follow the diver to the new link", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, diver } = await seatedDiver("person-draft");
    const copied = await issueAndDeliverPersonWaiver(db, shop.id, diver.id, { channel: "link" });
    if (!copied.ok) throw new Error("no waiver link");
    expect(
      await recordWaiverDraft(db, copied.token, {
        signerName: "Not The Diver",
        acknowledged: true,
        medicalAnswers: medicalReferralAnswers,
      }),
    ).toBe(true);

    await fixEmail(diver, "person-draft-fixed@example.com");
    const fresh = await issueAndDeliverPersonWaiver(db, shop.id, diver.id, { channel: "link" });
    if (!fresh.ok) throw new Error("no fresh link");
    const opened = await getWaiverForToken(db, fresh.token);
    if (opened.state !== "available") throw new Error(`fresh link is ${opened.state}`);
    expect(opened.record.draftSignerName).toBeNull();
    expect(opened.record.draftMedicalAnswers).toBeNull();
  });

  it("a course's forms link, which the waiver send mails undelivered, dies with the old address", async () => {
    // `deliverCourseFormsLink` mints the forms link without `delivered` (it is
    // the same row a staffer copies or the counter QR shows) and then mails or
    // texts it to the contact on file. A signable course release, so it goes.
    const { db, shop, diver, bookingId } = await seatedDiver("course-forms");
    const forms = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "course_forms",
    });
    if (!forms) throw new Error("no forms link");
    const formsLive = () =>
      verifyBookingCapability(db, { token: forms.token, purpose: "course_forms" }).then(Boolean);
    expect(await formsLive()).toBe(true);

    expect((await fixEmail(diver, "course-forms-fixed@example.com")).ok).toBe(true);

    expect(await formsLive()).toBe(false);
    const again = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "course_forms",
    });
    expect(again?.token).toBeDefined();
    expect(again?.token).not.toBe(forms.token);
  });

  /**
   * **The old link loses the doctor's door** (final attacker review B3). A
   * signed release held for a physician still opened on its waiver link, and
   * that link serves the doctor's page: the diver's name, the conditions
   * behind a date of birth, and the one form upload. Whoever holds the old
   * address must lose all three, and a form they sent before the change is
   * not evidence: the slot reopens for the diver.
   */
  it("a release held for a physician: the old link no longer opens the doctor's page or takes a form", async () => {
    const { db, shop, diver, bookingId } = await seatedDiver("held-doctor");
    const now = nowDate();
    const seatLink = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now });
    if (!seatLink.ok) throw new Error("no seat link");
    expect(
      await completeWaiver(db, seatLink.token, {
        signerName: diver.fullName,
        agreed: true,
        medicalAnswers: medicalReferralAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "medical_review" });
    const opened = await getWaiverForToken(db, seatLink.token);
    if (opened.state !== "completed") throw new Error(`old link is ${opened.state}`);
    expect(await doctorPageOpen(db, opened.record)).toBe(true);
    const forged = "https://storage.example/medical/forged-fit-to-dive.pdf";
    expect(await attachDiverMedicalForm(db, opened.record, forged)).toBe("sent");

    expect((await fixEmail(diver, "held-doctor-fixed@example.com")).ok).toBe(true);

    expect((await getWaiverForToken(db, seatLink.token)).state).toBe("unavailable");
    const [row] = await db
      .select()
      .from(waiverRecords)
      .where(inArray(waiverRecords.id, [seatLink.recordId]));
    expect(row?.diverMedicalFormUrl).toBeNull();
    expect(row?.diverMedicalFormSentAt).toBeNull();
    // Still the diver's hold, and still signed evidence: only the link moved.
    expect(row).toMatchObject({ status: "medical_review", supersededAt: null });
    if (!row) throw new Error("record missing");
    expect(await doctorPageOpen(db, row)).toBe(true);
    expect(await attachDiverMedicalForm(db, row, "https://storage.example/medical/real.pdf")).toBe(
      "sent",
    );
  });

  /**
   * **An upload already in flight cannot land** (security review S1). The
   * doctor's page reads the record from the old link, then spends seconds
   * storing the file; a contact change in between rotates the link and
   * reopens the slot. The write must still refuse a record read under the
   * old link, and so must the answers behind the date of birth.
   */
  it("refuses a form or the answers for a record read under the old link before the change", async () => {
    const { db, shop, diver, bookingId } = await seatedDiver("held-race");
    const now = nowDate();
    const seatLink = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now });
    if (!seatLink.ok) throw new Error("no seat link");
    await completeWaiver(db, seatLink.token, {
      signerName: diver.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    const opened = await getWaiverForToken(db, seatLink.token);
    if (opened.state !== "completed") throw new Error(`old link is ${opened.state}`);

    expect((await fixEmail(diver, "held-race-fixed@example.com")).ok).toBe(true);

    const stale = opened.record;
    expect(
      await attachDiverMedicalForm(db, stale, "https://storage.example/medical/forged.pdf"),
    ).toBe("closed");
    expect(await revealDoctorReferral(db, stale, "1990-01-01")).toBeNull();
  });

  it("a release the physician refused: the old link no longer says so", async () => {
    const { db, shop, diver, bookingId } = await seatedDiver("held-refused");
    const now = nowDate();
    const seatLink = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now });
    if (!seatLink.ok) throw new Error("no seat link");
    await completeWaiver(db, seatLink.token, {
      signerName: diver.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    expect(
      await recordMedicalEvaluationForShop(db, {
        outcome: "not_cleared",
        shopId: shop.id,
        personId: diver.id,
        recordedByPersonId: owner,
        evaluatedOn: calendarDateInTimezone(nowDate(), shop.timezone),
        physicianName: "Dr. Imani Reyes",
      }),
    ).toMatchObject({ ok: true });
    expect((await getWaiverForToken(db, seatLink.token)).state).toBe("completed");

    expect((await fixEmail(diver, "held-refused-fixed@example.com")).ok).toBe(true);

    expect((await getWaiverForToken(db, seatLink.token)).state).toBe("unavailable");
  });

  it("leaves a signed release and a release held for a physician exactly as they were", async () => {
    const { db, shop, diver, bookingId } = await seatedDiver("signed");
    const now = nowDate();
    const seatLink = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now });
    if (!seatLink.ok) throw new Error("no seat link");
    expect(
      await completeWaiver(db, seatLink.token, {
        signerName: diver.fullName,
        agreed: true,
        medicalAnswers: medicalReferralAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "medical_review" });
    const personLink = await issueWaiverRequest(db, { shopId: shop.id, personId: diver.id, now });
    if (!personLink.ok) throw new Error("no person link");
    expect(
      await completeWaiver(db, personLink.token, {
        signerName: diver.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
    const signedRows = () =>
      db
        .select()
        .from(waiverRecords)
        .where(inArray(waiverRecords.id, [seatLink.recordId, personLink.recordId]))
        .orderBy(waiverRecords.id);
    const before = await signedRows();

    expect((await fixEmail(diver, "signed-fixed@example.com")).ok).toBe(true);

    // Every column but the bearer link, which moves on every signed release
    // (final attacker review B3, security review S2): the old link opens
    // neither the held one nor the clean one's receipt.
    const withoutLink = (rows: typeof before) =>
      rows.map(({ tokenHash: _tokenHash, ...row }) => row);
    const after = await signedRows();
    expect(withoutLink(after)).toEqual(withoutLink(before));
    const linkOf = (rows: typeof before, id: string) =>
      rows.find((row) => row.id === id)?.tokenHash;
    expect(linkOf(after, seatLink.recordId)).not.toBe(linkOf(before, seatLink.recordId));
    expect(linkOf(after, personLink.recordId)).not.toBe(linkOf(before, personLink.recordId));
    expect((await getWaiverForToken(db, personLink.token)).state).toBe("unavailable");
    expect(before.every((row) => row.supersededAt === null)).toBe(true);
  });

  it("touches no other diver's link", async () => {
    const { db, diver, waiver } = await seatedDiver("bystander-a");
    const other = await seatedDiver("bystander-b");

    expect((await fixEmail(diver, "bystander-a-fixed@example.com")).ok).toBe(true);

    expect((await getWaiverForToken(db, waiver)).state).toBe("unavailable");
    expect((await getWaiverForToken(db, other.waiver)).state).toBe("available");
    expect(await live(other.delivered)).toBe(true);
  });
});
