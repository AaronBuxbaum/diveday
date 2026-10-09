import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { boatCertificateError, boatRowId } from "./certificate-error";

const t = staffTranslator("en-US");

/**
 * The fleet row's H-107 field error, read back off the redirect. The numbers
 * arrive in a query string anyone can edit, so anything that is not a small
 * whole number says nothing rather than a garbled sentence.
 */
describe("boatCertificateError", () => {
  it("says the seats-over-certificate sentence on the row it names", () => {
    expect(
      boatCertificateError(t, {
        notice: "boat-above-certificate",
        boat: "b1",
        capacity: "14",
        limit: "12",
      }),
    ).toEqual({
      boat: "b1",
      text: "The certificate allows 12 passengers, so this boat can’t sell 14. Lower the seats, or correct the certificate.",
    });
  });

  it("counts the departures still selling above a lowered certificate", () => {
    expect(
      boatCertificateError(t, {
        notice: "boat-departures-above-certificate",
        boat: "b1",
        count: "2",
        limit: "10",
      })?.text,
    ).toBe(
      "2 upcoming departures on this boat sell more seats than the certificate’s 10. Lower their capacity first.",
    );
  });

  it("says nothing for another notice, a missing row, or numbers that are not numbers", () => {
    expect(boatCertificateError(t, { notice: "boat-updated", boat: "b1", limit: "12" })).toBeNull();
    expect(
      boatCertificateError(t, { notice: "boat-above-certificate", capacity: "14", limit: "12" }),
    ).toBeNull();
    expect(
      boatCertificateError(t, {
        notice: "boat-above-certificate",
        boat: "b1",
        capacity: "<b>14</b>",
        limit: "12",
      }),
    ).toBeNull();
  });

  it("anchors each row, and the add form as 'new'", () => {
    expect(boatRowId("new")).toBe("boat-new");
  });
});
