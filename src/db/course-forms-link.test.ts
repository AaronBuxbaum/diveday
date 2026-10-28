import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext, markSeat } from "@/test/training-mark-context";
import { issueBookingCapability, revokeBookingCapabilities } from "./booking-capabilities";
import {
  courseFormDisplayDigest,
  getCourseFormsForBooking,
  signCourseFormForLink,
  verifyCourseFormsLink,
} from "./course-forms";

const ctx = fileScopedShopContext();

describe("course forms link authorization at signing", () => {
  it("refuses a token revoked after the page verified it", async () => {
    const setup = await charterContext(ctx);
    await markSeat(setup);
    const issued = await issueBookingCapability(setup.db, {
      shopId: setup.shop.id,
      bookingId: setup.seat.id,
      purpose: "course_forms",
    });
    if (!issued) throw new Error("capability missing");
    const link = await verifyCourseFormsLink(setup.db, issued.token);
    if (!link) throw new Error("capability did not verify");
    await revokeBookingCapabilities(setup.db, { shopId: setup.shop.id, bookingId: setup.seat.id });
    expect(
      await signCourseFormForLink(setup.db, {
        ...link,
        token: issued.token,
        displayedDigest: "",
        formVersionId: setup.form.versionId as string,
        signerName: setup.course.fullName,
        agreed: true,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
  it("refuses an empty bearer instead of falling through to trusted signing", async () => {
    const setup = await charterContext(ctx);
    await markSeat(setup);
    expect(
      await signCourseFormForLink(setup.db, {
        shopId: setup.shop.id,
        bookingId: setup.seat.id,
        token: "",
        displayedDigest: "",
        formVersionId: setup.form.versionId as string,
        signerName: setup.course.fullName,
        agreed: true,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
  it("accepts only the clicked seat's forms or readiness capability", async () => {
    const setup = await charterContext(ctx);
    await markSeat(setup);
    const forms = await issueBookingCapability(setup.db, {
      shopId: setup.shop.id,
      bookingId: setup.seat.id,
      purpose: "course_forms",
    });
    const ready = await issueBookingCapability(setup.db, {
      shopId: setup.shop.id,
      bookingId: setup.seat.id,
      purpose: "readiness",
    });
    const otherPurpose = await issueBookingCapability(setup.db, {
      shopId: setup.shop.id,
      bookingId: setup.seat.id,
      purpose: "confirm",
    });
    const otherSeat = await issueBookingCapability(setup.db, {
      shopId: setup.shop.id,
      bookingId: setup.course.bookingId,
      purpose: "course_forms",
    });
    if (!forms || !ready || !otherPurpose || !otherSeat) throw new Error("capabilities missing");
    const page = await getCourseFormsForBooking(setup.db, setup.shop.id, setup.seat.id);
    const displayed = page?.outstanding[0];
    if (!page || !displayed) throw new Error("displayed form missing");
    const input = {
      shopId: setup.shop.id,
      bookingId: setup.seat.id,
      formVersionId: setup.form.versionId as string,
      displayedDigest: courseFormDisplayDigest({
        shopId: setup.shop.id,
        bookingId: setup.seat.id,
        formVersionId: displayed.versionId,
        body: displayed.body,
        context: page.enrollment.context,
      }),
      signerName: setup.course.fullName,
      agreed: true,
    };
    expect(await signCourseFormForLink(setup.db, { ...input, token: otherPurpose.token })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await signCourseFormForLink(setup.db, { ...input, token: otherSeat.token })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await signCourseFormForLink(setup.db, { ...input, token: forms.token })).toMatchObject({
      ok: true,
      alreadySigned: false,
    });
    expect(await signCourseFormForLink(setup.db, { ...input, token: ready.token })).toMatchObject({
      ok: true,
      alreadySigned: true,
    });
  });
});
