import { describe, expect, it } from "vitest";
import {
  draftableFields,
  draftHasContent,
  draftIsFresh,
  FORM_DRAFT_TTL_MS,
  isDraftableField,
} from "./form-drafts";

/** ADR 20260906-before-you-ask, decision 3: what a draft may hold, and for how long. */
describe("draftableFields", () => {
  it("keeps a form's own content and nothing on the never-list", () => {
    expect(
      draftableFields([
        ["fullName", "Emmet O'Brien"],
        ["email", "emmet.ob@example.com"],
        ["cardNumber", "4242"],
        ["medicalAnswer3", "yes"],
        ["questionnaireQ1", "no"],
        ["password", "hunter2"],
        ["holdKind", "waiver_send"],
        ["", "nameless"],
      ]),
    ).toEqual({ fullName: "Emmet O'Brien", email: "emmet.ob@example.com" });
  });

  it("keeps every value of a multi-valued field under one name", () => {
    expect(
      draftableFields([
        ["repeatWeekdays", "1"],
        ["repeatWeekdays", "4"],
      ]),
    ).toEqual({ repeatWeekdays: "1 4" });
  });

  it("bounds a draft: an essay is not a field, and eighty fields is a form", () => {
    expect(draftableFields([["notes", "x".repeat(5_000)]])).toEqual({});
    const many = Array.from({ length: 100 }, (_, i) => [`f${i}`, String(i)] as [string, string]);
    expect(Object.keys(draftableFields(many))).toHaveLength(80);
  });
});

describe("isDraftableField", () => {
  it.each(["cvv", "cardExpiry", "iban", "medicalNote", "resetToken", "apiSecret", "otpCode"])(
    "refuses %s",
    (name) => expect(isDraftableField(name)).toBe(false),
  );
  it.each(["fullName", "phone", "date", "startTime", "title", "description"])("allows %s", (name) =>
    expect(isDraftableField(name)).toBe(true),
  );

  it("opts in only the three fixed boat document dates", () => {
    expect(
      draftableFields(
        [
          ["coiExpiresOn", "2027-01-01"],
          ["registrationExpiresOn", "2027-02-01"],
          ["insuranceExpiresOn", "2027-03-01"],
          ["cardExpiresOn", "11/30"],
          ["medicalExpiresOn", "private"],
          ["secretExpiresOn", "credential"],
          ["passwordExpiresOn", "credential"],
          ["apiTokenExpiresOn", "credential"],
          ["arbitraryExpiresOn", "surprise"],
        ],
        "boat-paper-dates",
      ),
    ).toEqual({
      coiExpiresOn: "2027-01-01",
      registrationExpiresOn: "2027-02-01",
      insuranceExpiresOn: "2027-03-01",
    });
  });

  it("does not allow the boat policy to opt in payment, medical, secrets or arbitrary expired fields", () => {
    for (const name of [
      "cardExpiry",
      "medicalNote",
      "secretToken",
      "apiSecret",
      "passwordExpiry",
      "arbitraryExpiresOn",
    ]) {
      expect(isDraftableField(name, "boat-paper-dates"), name).toBe(false);
    }
  });
});

describe("draftIsFresh", () => {
  it("lives a day", () => {
    const savedAt = new Date("2026-08-27T06:02:00Z");
    expect(draftIsFresh(savedAt, new Date("2026-08-27T18:00:00Z"))).toBe(true);
    expect(draftIsFresh(savedAt, new Date(savedAt.getTime() + FORM_DRAFT_TTL_MS))).toBe(false);
  });
});

describe("draftHasContent", () => {
  it("counts one typed character and not a form of blanks", () => {
    expect(draftHasContent({ fullName: "", email: "  " })).toBe(false);
    expect(draftHasContent({ fullName: "E" })).toBe(true);
  });
});
