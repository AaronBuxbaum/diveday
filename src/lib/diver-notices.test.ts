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
