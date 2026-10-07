import { describe, expect, it } from "vitest";
import { AGENCY_VERIFICATION_PAGES, agencyVerificationUrl } from "./agency-verification";
import { CERTIFICATION_AGENCIES } from "./certification-options";

/**
 * Pinned host per agency: a link that wandered to a reseller, a shop's blog or
 * an aggregator would send a staffer to check a card somewhere that is not the
 * agency's own record.
 */
const AGENCY_HOSTS: Record<string, string> = {
  ssi: "my.divessi.com",
  naui: "www.naui.org",
  sdi: "www.tdisdi.com",
  tdi: "www.tdisdi.com",
  cmas: "portal.cmas.org",
  gue: "www.gue.com",
  padi: "pro.padi.com",
};

describe("agency verification pages", () => {
  it("lists exactly the agencies confirmed to publish a lookup", () => {
    expect(Object.keys(AGENCY_VERIFICATION_PAGES).sort()).toEqual(Object.keys(AGENCY_HOSTS).sort());
  });

  it("points every entry at the agency's own domain over https", () => {
    for (const [agency, page] of Object.entries(AGENCY_VERIFICATION_PAGES)) {
      const url = new URL(page?.url ?? "");
      expect(url.protocol, agency).toBe("https:");
      expect(url.host, agency).toBe(AGENCY_HOSTS[agency]);
    }
  });

  it("never carries a query string, so nothing about a diver can ride along", () => {
    for (const page of Object.values(AGENCY_VERIFICATION_PAGES)) {
      const url = new URL(page?.url ?? "");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    }
  });

  it("names only agencies the certification enum knows", () => {
    for (const agency of Object.keys(AGENCY_VERIFICATION_PAGES)) {
      expect(CERTIFICATION_AGENCIES).toContain(agency);
    }
  });

  it("says which links need a sign-in and which search a portal with gaps", () => {
    const kinds = Object.fromEntries(
      Object.entries(AGENCY_VERIFICATION_PAGES).map(([agency, page]) => [agency, page?.kind]),
    );
    expect(kinds).toEqual({
      ssi: "check",
      naui: "check",
      sdi: "check",
      tdi: "check",
      gue: "check",
      cmas: "search_portal",
      padi: "member_sign_in",
    });
  });

  it("answers null for an agency with no lookup, and for other", () => {
    expect(agencyVerificationUrl("raid")).toBeNull();
    expect(agencyVerificationUrl("bsac")).toBeNull();
    expect(agencyVerificationUrl("other")).toBeNull();
    expect(agencyVerificationUrl("ssi")).toBe("https://my.divessi.com/online_diver_check");
  });
});
