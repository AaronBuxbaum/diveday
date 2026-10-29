import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { boatCertificateError, boatRowId } from "./certificate-error";

const LOCALE = "en-US";
const t = staffTranslator(LOCALE);
/** Dates keep their parts on one line with no-break spaces; compare the words. */
const plain = (text: string | undefined) => text?.replace(/\u00a0/g, " ");

/**
 * The fleet row's H-107 field error, read back off the redirect. The numbers
 * arrive in a query string anyone can edit, so anything that is not a small
 * whole number says nothing rather than a garbled sentence.
 */
describe("boatCertificateError", () => {
  it("says more passengers than persons is a typo in one of the two boxes (issue 2302)", () => {
    expect(
      boatCertificateError(
        t,
        { notice: "boat-passengers-above-persons", boat: "b1", passengers: "14", limit: "12" },
        LOCALE,
      ),
    ).toEqual({
      boat: "b1",
      text: "The certificate allows 12 persons in all, so it can’t allow 14 passengers. Correct one of the two.",
    });
    expect(
      boatCertificateError(
        t,
        { notice: "boat-passengers-above-persons", boat: "b1", passengers: "x", limit: "12" },
        LOCALE,
      ),
    ).toBeNull();
  });

  it("says total occupant capacity above persons is a mismatch", () => {
    expect(
      boatCertificateError(
        t,
        { notice: "boat-capacity-above-persons", boat: "b1", capacity: "20", limit: "12" },
        LOCALE,
      ),
    ).toEqual({
      boat: "b1",
      text: "The certificate allows 12 persons in all, so total boat capacity 20 is too high. Correct one of the two.",
    });
  });

  it("counts the departures still selling above a lowered certificate", () => {
    expect(
      boatCertificateError(
        t,
        {
          notice: "boat-departures-above-certificate",
          boat: "b1",
          count: "2",
          limit: "10",
        },
        LOCALE,
      )?.text,
    ).toBe(
      "2 upcoming departures on this boat sell more seats than the certificate’s 10. Lower their capacity first.",
    );
  });

  it("names the departures by date when the redirect carried them", () => {
    expect(
      plain(
        boatCertificateError(
          t,
          {
            notice: "boat-departures-above-certificate",
            boat: "b1",
            count: "4",
            limit: "10",
            dates: "2026-10-11,2026-10-18,2026-10-25",
          },
          LOCALE,
        )?.text,
      ),
    ).toBe(
      "4 upcoming departures on this boat sell more seats than the certificate’s 10, including Oct 11, 2026, Oct 18, 2026, and Oct 25, 2026. Lower their capacity first.",
    );
    expect(
      plain(
        boatCertificateError(
          t,
          {
            notice: "boat-departures-above-certificate",
            boat: "b1",
            count: "1",
            limit: "10",
            dates: "2026-10-11",
          },
          LOCALE,
        )?.text,
      ),
    ).toBe(
      "The departure on Oct 11, 2026 sells more seats than the certificate’s 10. Lower its capacity first.",
    );
    // Dates that are not dates fall back to the count alone.
    expect(
      plain(
        boatCertificateError(
          t,
          {
            notice: "boat-departures-above-certificate",
            boat: "b1",
            count: "1",
            limit: "10",
            dates: "<script>",
          },
          LOCALE,
        )?.text,
      ),
    ).toBe(
      "1 upcoming departure on this boat sells more seats than the certificate’s 10. Lower its capacity first.",
    );
  });

  it("says nothing for another notice, a missing row, or numbers that are not numbers", () => {
    expect(
      boatCertificateError(t, { notice: "boat-updated", boat: "b1", limit: "12" }, LOCALE),
    ).toBeNull();
    expect(
      boatCertificateError(
        t,
        { notice: "boat-capacity-above-persons", capacity: "14", limit: "12" },
        LOCALE,
      ),
    ).toBeNull();
    expect(
      boatCertificateError(
        t,
        {
          notice: "boat-capacity-above-persons",
          boat: "b1",
          capacity: "<b>14</b>",
          limit: "12",
        },
        LOCALE,
      ),
    ).toBeNull();
  });

  it("anchors each row, and the add form as 'new'", () => {
    expect(boatRowId("new")).toBe("boat-new");
  });
});
