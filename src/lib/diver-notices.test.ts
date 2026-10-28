import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { resolveDiverNotice } from "./diver-notices";
import type { TripAdmissionRefusal } from "./trip-admission";
import { signTripAdmissionGate } from "./trip-admission-gate";

const PERSON = "00000000-0000-4000-8000-000000000001";
const OTHER_PERSON = "00000000-0000-4000-8000-000000000002";
const t = staffTranslator("en-US");

const REFUSAL: TripAdmissionRefusal = {
  requiredLevel: "advanced_open_water",
  heldLevel: "open_water",
  missingSpecialties: [],
  nitroxRequired: false,
};

const resolve = (input: Partial<Parameters<typeof resolveDiverNotice>[0]>) =>
  resolveDiverNotice({ personId: PERSON, locale: "en-US", ...input });

describe("the diver record's notice", () => {
  it("resolves nothing for no code or a code it does not know", () => {
    expect(resolve({})).toBeUndefined();
    expect(resolve({ notice: "made-up-code" })).toBeUndefined();
  });

  it("answers a trip prerequisite with the signed refusal, when it is this diver's", () => {
    const gate = signTripAdmissionGate(REFUSAL, { kind: "diver", id: PERSON });
    expect(resolve({ notice: "trip-prerequisite", gate })?.text).toBe(
      tripAdmissionRefusalText(t, REFUSAL, "en-US"),
    );
  });

  it("falls back to the generic sentence for a gate signed for another diver, or for a trip", () => {
    const generic = t("divers.notices.tripPrerequisite");
    for (const gate of [
      signTripAdmissionGate(REFUSAL, { kind: "diver", id: OTHER_PERSON }),
      signTripAdmissionGate(REFUSAL, { kind: "trip", id: PERSON }),
    ]) {
      expect(resolve({ notice: "trip-prerequisite", gate })?.text).toBe(generic);
    }
  });

  it("falls back to the generic sentence for a tampered, repeated or missing gate", () => {
    const generic = t("divers.notices.tripPrerequisite");
    const signed = signTripAdmissionGate(REFUSAL, { kind: "diver", id: PERSON });
    const [payload, signature] = signed.split(".");
    const forged = `${payload?.replace("advanced_open_water", "rescue")}.${signature}`;
    for (const gate of [forged, `${signed}x`, [signed, signed], undefined, ""]) {
      expect(resolve({ notice: "trip-prerequisite", gate })?.text).toBe(generic);
    }
  });

  it("never reads a gate on any other notice", () => {
    const gate = signTripAdmissionGate(REFUSAL, { kind: "diver", id: PERSON });
    expect(resolve({ notice: "trip-unavailable", gate })?.text).toBe(
      t("divers.notices.tripUnavailable"),
    );
  });

  it("routes to the form the action named, and only to a form the page has", () => {
    expect(resolve({ notice: "booked", form: "story" })?.form).toBe("story");
    expect(resolve({ notice: "booked", form: "<script>" })?.form).toBe("book");
  });

  it("tells a reader without the invoice link only that it booked", () => {
    expect(resolve({ notice: "booked" })?.text).toBe(t("divers.notices.bookedNoInvoice"));
    expect(resolve({ notice: "booked", canRaiseInvoice: true })?.text).toBe(
      t("divers.notices.booked"),
    );
  });

  it("says the diver was told when a later-day booking's confirmation went out (fourth UX review, item 3)", () => {
    expect(resolve({ notice: "booked-confirmed", canRaiseInvoice: true })?.text).toBe(
      t("divers.notices.bookedConfirmed"),
    );
    expect(resolve({ notice: "booked-confirmed" })?.text).toBe(
      t("divers.notices.bookedConfirmedNoInvoice"),
    );
  });

  it("says a saved form's “18 or older” went unused because a date is on file (#2167)", () => {
    expect(resolve({ notice: "person-saved-adult-answer-unused" })).toMatchObject({
      form: "details",
      tone: "warning",
      text: t("divers.notices.personSavedAdultAnswerUnused"),
    });
  });

  it("carries a card id only on a notice that names a box", () => {
    expect(resolve({ notice: "card-number-implausible", card: "card-1" })).toMatchObject({
      field: "sighted-identifier",
      cardId: "card-1",
    });
    expect(resolve({ notice: "duplicate-card", card: "card-1" })?.cardId).toBeUndefined();
  });

  it("withholds the words of a silent success, and still routes it", () => {
    expect(resolve({ notice: "captured" })).toMatchObject({
      form: "cards",
      text: "",
      silent: true,
    });
  });

  it("links the one refusal that has somewhere to send the staffer", () => {
    const notice = resolve({ notice: "payment-not-connected" });
    expect(notice?.link?.href("blue-mantis")).toBe("/shop/blue-mantis/settings#money");
    expect(resolve({ notice: "booked" })?.link).toBeUndefined();
  });
});

/**
 * **A refused merge names the departure it is about** (issue #2333). The
 * departure is read by the page from the shop's own trips, never from words in
 * the URL, and a refusal with none to name keeps the general sentence.
 */
describe("the merge booking-conflict notice", () => {
  it("names the departure when the page found one", () => {
    const notice = resolveDiverNotice({
      notice: "merge-booking-conflict",
      personId: "person-1",
      locale: "en-US",
      conflictDeparture: "Two-Tank Reef · Sat, Jul 25, 8:00 AM EDT",
    });
    expect(notice?.text).toContain("Two-Tank Reef · Sat, Jul 25, 8:00 AM EDT");
    expect(notice?.tone).toBe("danger");
  });

  it("keeps the general sentence without one, and never names a departure on another notice", () => {
    const t = staffTranslator("en-US");
    expect(
      resolveDiverNotice({ notice: "merge-booking-conflict", personId: "p", locale: "en-US" })
        ?.text,
    ).toBe(t("divers.notices.mergeBookingConflict"));
    expect(
      resolveDiverNotice({
        notice: "merge-invalid",
        personId: "p",
        locale: "en-US",
        conflictDeparture: "Two-Tank Reef",
      })?.text,
    ).toBe(t("divers.notices.mergeInvalid"));
  });
});

describe("successful diver merge recovery guidance", () => {
  it("tells staff where to resend booking and course-form links", () => {
    const notice = resolve({ notice: "merged" });
    expect(notice?.text).toContain("resend it from the booking");
    expect(notice?.text).not.toContain("https://");
  });
});

describe("the named earned moment", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    it(`formats the record name as escaped text in ${locale}`, () => {
      const name = "María <Boat> & O’Neil";
      const notice = resolve({ notice: "diver-clear", locale, personName: name });
      expect(notice?.code).toBe("diver-clear");
      expect(notice?.text).toBe(staffTranslator(locale)("divers.notices.cleared", { name }));
      const html = renderToStaticMarkup(createElement("p", null, notice?.text));
      expect(html).toContain("&lt;Boat&gt; &amp;");
      expect(html).not.toContain("<Boat>");
    });
    it(`keeps older or blank-name callers readable in ${locale}`, () => {
      const t = staffTranslator(locale);
      for (const personName of [undefined, "  "]) {
        expect(resolve({ notice: "diver-clear", locale, personName })?.text).toBe(
          t("divers.notices.cleared", { name: t("shared.waiverSend.unnamedDiver") }),
        );
      }
    });
  }
});
