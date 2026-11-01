import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getBookingReadiness } from "./readiness";
import { bookings, waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "./waivers-test-fixtures";

const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

describe("person-scoped waiver requests after booking referrals", () => {
  it("issues a later clean release while keeping the referral's booking on hold", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const cleanAt = now;
    const first = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: cleanAt,
    });
    if (!first.ok) throw new Error("expected an initial person-scoped link");
    await completeWaiver(db, first.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now: cleanAt,
    });

    const referralAt = new Date(cleanAt.getTime() + 60_000);
    const referral = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: referralAt,
    });
    if (!referral.ok) throw new Error("expected a booking-scoped referral link");
    await completeWaiver(db, referral.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: referralAt,
    });

    const cleanReleaseAt = new Date(referralAt.getTime() + 60_000);
    const laterRelease = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: cleanReleaseAt,
    });
    if (!laterRelease.ok) throw new Error("expected a new person-scoped clean-release link");
    await completeWaiver(db, laterRelease.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now: cleanReleaseAt,
    });

    expect((await getBookingReadiness(db, shop.id, booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "medical_review" }),
    );
  });

  it("still offers a resend after an unanswered booking referral is superseded", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id, now });
    if (!first.ok) throw new Error("expected an initial person-scoped link");
    await completeWaiver(db, first.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    const referralAt = new Date(now.getTime() + 60_000);
    const referral = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: referralAt,
    });
    if (!referral.ok) throw new Error("expected a booking-scoped referral link");
    await completeWaiver(db, referral.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: referralAt,
    });

    // A replacement link retires the seat's row, but it does not answer the
    // referral or make the older person release stand again.
    const supersededAt = new Date(referralAt.getTime() + 60_000);
    await db
      .update(waiverRecords)
      .set({ supersededAt })
      .where(eq(waiverRecords.id, referral.recordId));
    const replacement = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: new Date(supersededAt.getTime() + 60_000),
    });
    if (!replacement.ok) throw new Error("expected a replacement booking link");

    expect((await getBookingReadiness(db, shop.id, booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "medical_review" }),
    );
    const resend = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: new Date(supersededAt.getTime() + 120_000),
    });
    expect(resend.ok).toBe(true);
  });

  it("does not carry a booking referral forward after the seat changes diver", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id, now });
    if (!first.ok) throw new Error("expected an initial person-scoped link");
    await completeWaiver(db, first.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    const referralAt = new Date(now.getTime() + 60_000);
    const referral = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: referralAt,
    });
    if (!referral.ok) throw new Error("expected a booking-scoped referral link");
    await completeWaiver(db, referral.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: referralAt,
    });

    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    await db.update(bookings).set({ personId: staff.person.id }).where(eq(bookings.id, booking.id));

    expect(
      await issueWaiverRequest(db, {
        shopId: shop.id,
        personId: person.id,
        now: new Date(referralAt.getTime() + 60_000),
      }),
    ).toEqual({ ok: false, reason: "already_completed" });
  });
});
