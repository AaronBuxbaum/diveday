import { describe, expect, it } from "vitest";
import {
  encodeReferralCookie,
  partnerFromReferralCookie,
  partnerFromSearchParams,
  partnerReferralSlug,
} from "./referrals";

describe("partnerReferralSlug", () => {
  it("slugs a hotel's name the way the link builder writes it", () => {
    expect(partnerReferralSlug("Coral Sands Resort")).toBe("coral-sands-resort");
  });

  it("collapses punctuation and accents into single dashes", () => {
    expect(partnerReferralSlug("  Hôtel  Blue & Sea!!  ")).toBe("h-tel-blue-sea");
  });

  it("is null for anything that slugs to nothing, so 'no partner' is one value", () => {
    expect(partnerReferralSlug("")).toBeNull();
    expect(partnerReferralSlug("   ")).toBeNull();
    expect(partnerReferralSlug("!!!")).toBeNull();
    expect(partnerReferralSlug(null)).toBeNull();
    expect(partnerReferralSlug(undefined)).toBeNull();
  });

  it("bounds the slug, so a cookie cannot become free storage on a booking", () => {
    const slug = partnerReferralSlug("a".repeat(500));
    expect(slug).toBe("a".repeat(64));
  });

  it("never leaves a trailing dash, including one a truncation would create", () => {
    // 63 a's then a space then more: the slice lands exactly on the dash.
    const slug = partnerReferralSlug(`${"a".repeat(63)} tail`);
    expect(slug).toBe("a".repeat(63));
  });

  it("is idempotent — what the link builder wrote, the reader accepts unchanged", () => {
    const once = partnerReferralSlug("Coral Sands Resort & Dive Lodge");
    expect(partnerReferralSlug(once)).toBe(once);
  });

  it("strips anything that is not a-z0-9, so no path or script can reach the column", () => {
    expect(partnerReferralSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(partnerReferralSlug("<script>alert(1)</script>")).toBe("script-alert-1-script");
  });
});

describe("partnerFromSearchParams", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("reads the partner off a link the generator wrote", () => {
    expect(
      partnerFromSearchParams(
        params("utm_source=partner&utm_medium=referral&utm_campaign=coral-sands"),
      ),
    ).toBe("coral-sands");
  });

  it("ignores an ordinary campaign that is not a partner link", () => {
    expect(partnerFromSearchParams(params("utm_source=newsletter&utm_campaign=spring"))).toBeNull();
  });

  it("ignores utm_source=partner naming no partner", () => {
    expect(partnerFromSearchParams(params("utm_source=partner"))).toBeNull();
    expect(partnerFromSearchParams(params("utm_source=partner&utm_campaign="))).toBeNull();
  });

  /**
   * `get()` silently returns the first of a repeated parameter, so a crafted
   * `?utm_source=x&utm_source=partner` would mean one thing here and another
   * to any reader that looks at the array. Same shape src/proxy.ts already
   * uses for `?embed=`.
   */
  it("refuses a repeated utm_source or utm_campaign rather than taking the first", () => {
    expect(
      partnerFromSearchParams(params("utm_source=partner&utm_source=x&utm_campaign=a")),
    ).toBeNull();
    expect(
      partnerFromSearchParams(params("utm_source=partner&utm_campaign=a&utm_campaign=b")),
    ).toBeNull();
  });

  it("normalises a hand-typed campaign rather than storing it as given", () => {
    expect(partnerFromSearchParams(params("utm_source=partner&utm_campaign=Coral%20Sands"))).toBe(
      "coral-sands",
    );
  });
});

describe("partnerFromReferralCookie", () => {
  it("reads back a referral minted on this shop's own storefront", () => {
    const cookie = encodeReferralCookie("blue-mantis", "coral-sands");
    expect(partnerFromReferralCookie(cookie, "blue-mantis")).toBe("coral-sands");
  });

  /**
   * The finding this function exists for. One cookie covers the whole `/s/`
   * namespace, so a guest who opens shop A's partner link and then books at
   * shop B arrives carrying A's referral. Crediting it would hand shop B a
   * partner it has no relationship with, by name.
   */
  it("refuses another shop's referral", () => {
    const cookie = encodeReferralCookie("blue-mantis", "coral-sands");
    expect(partnerFromReferralCookie(cookie, "reef-runners")).toBeNull();
  });

  it("refuses a value that names no shop at all", () => {
    expect(partnerFromReferralCookie("coral-sands", "blue-mantis")).toBeNull();
    expect(partnerFromReferralCookie("", "blue-mantis")).toBeNull();
    expect(partnerFromReferralCookie(undefined, "blue-mantis")).toBeNull();
  });

  it("normalises the partner half rather than trusting a hand-set cookie", () => {
    expect(partnerFromReferralCookie("blue-mantis:<script>", "blue-mantis")).toBe("script");
    expect(partnerFromReferralCookie(`blue-mantis:${"a".repeat(500)}`, "blue-mantis")).toBe(
      "a".repeat(64),
    );
    expect(partnerFromReferralCookie("blue-mantis:", "blue-mantis")).toBeNull();
  });

  it("splits on the first colon, so a partner cannot smuggle a second shop", () => {
    // The partner half never contains a colon after slugging, but the split has
    // to be unambiguous before that: a value is one shop and one remainder.
    expect(partnerFromReferralCookie("blue-mantis:reef-runners:x", "blue-mantis")).toBe(
      "reef-runners-x",
    );
    expect(partnerFromReferralCookie("blue-mantis:reef-runners:x", "reef-runners")).toBeNull();
  });
});
