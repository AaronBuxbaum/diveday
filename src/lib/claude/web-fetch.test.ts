import { describe, expect, it } from "vitest";
import { allowedFetchHost, webFetchTool } from "./web-fetch";

describe("allowedFetchHost", () => {
  it("reads the host out of a pasted website, URL or bare", () => {
    expect(allowedFetchHost("https://www.BlueReefDivers.com/trips?x=1")).toBe(
      "www.bluereefdivers.com",
    );
    expect(allowedFetchHost("bluereefdivers.com")).toBe("bluereefdivers.com");
    expect(allowedFetchHost("  http://shop.example.org/  ")).toBe("shop.example.org");
  });

  it("keeps a builder subdomain whole, so the allowance never widens to the builder", () => {
    expect(allowedFetchHost("https://bluereef.wixsite.com/home")).toBe("bluereef.wixsite.com");
    expect(allowedFetchHost("https://www.bluereef.squarespace.com")).toBe(
      "www.bluereef.squarespace.com",
    );
    expect(allowedFetchHost("bluereefdivers.co.uk")).toBe("bluereefdivers.co.uk");
  });

  it("refuses a registry or a builder's shared root, which would allow every site under it", () => {
    for (const input of [
      "co.uk",
      "www.co.uk",
      "https://com.au/",
      "wixsite.com",
      "https://www.wixsite.com/bluereef",
      "github.io",
      "squarespace.com",
      "netlify.app",
      "sites.google.com/view/bluereef",
      "facebook.com/bluereefdivers",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
  });

  it("refuses anything that is not a public web host", () => {
    for (const input of [
      "",
      "localhost",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://[::1]/",
      "10.0.0.4",
      "intranet",
      "com",
      "ftp://bluereef.com",
      "javascript:alert(1)",
      "https://user:pass@bluereef.com",
      "https://bluereef.com:8443",
      "https://shop.local",
      "https://shop.internal",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
  });
});

/**
 * Every root the hand-kept list refused before the Public Suffix List took over
 * (ADR 20261102-website-assist-public-suffix-list). None of them may ever be
 * accepted, bare or with `www.`, whatever tldts' data says.
 */
const FORMER_SHARED_ROOTS =
  `co.uk org.uk me.uk ltd.uk plc.uk net.uk ac.uk gov.uk com.au net.au org.au
co.nz org.nz co.za co.jp ne.jp or.jp co.kr com.br com.mx com.ar com.co com.pe com.ph com.my com.sg
com.hk com.tw com.cn co.id co.th com.tr com.eg com.ec com.do com.pa com.gt co.cr co.il co.in com.es
com.pt com.fj com.vn com.mt com.cy gr.com wixsite.com wix.com squarespace.com square.site weebly.com
wordpress.com blogspot.com blogger.com github.io gitlab.io netlify.app vercel.app pages.dev
webflow.io godaddysites.com carrd.co myshopify.com herokuapp.com web.app firebaseapp.com
azurewebsites.net cloudfront.net amazonaws.com sites.google.com google.com facebook.com
instagram.com linktr.ee wa.me tripadvisor.com`.split(/\s+/);

describe("allowedFetchHost and the Public Suffix List", () => {
  it("still refuses every root the hand-kept list refused, with and without www", () => {
    for (const root of FORMER_SHARED_ROOTS) {
      expect(allowedFetchHost(root), root).toBeNull();
      expect(allowedFetchHost(`www.${root}`), `www.${root}`).toBeNull();
      expect(allowedFetchHost(`https://${root.toUpperCase()}./x`), root).toBeNull();
    }
  });

  it("still allows one shop's own name under a registry or a platform", () => {
    for (const input of [
      "bluereef.co.uk",
      "bluereef.com.au",
      "bluereef.myshopify.com",
      "bluereef.vercel.app",
      "bluereef.pages.dev",
      "bluereef.github.io",
      "www.bluereef.blogspot.com",
      "bluereef.wix.com",
    ]) {
      expect(allowedFetchHost(input), input).toBe(input.toLowerCase());
    }
  });

  it("refuses registries and platforms the hand-kept list never named", () => {
    for (const input of [
      "org.au",
      "com.ua",
      "ac.nz",
      "co.ve",
      "vercel.dev",
      "onrender.com",
      "fly.dev",
      "workers.dev",
      "s3.amazonaws.com",
      "b.ck",
      "www.co.ke",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
  });

  it("reads a wildcard suffix as a suffix, so only a name under it is a site", () => {
    expect(allowedFetchHost("b.ck")).toBeNull();
    expect(allowedFetchHost("shop.b.ck")).toBe("shop.b.ck");
    // Changed on purpose: the hand-kept list let this through. Dropping `www.` first,
    // as the check always has, leaves `b.ck`, a suffix.
    expect(allowedFetchHost("www.b.ck")).toBeNull();
    // The exception rule makes www.ck a name, but `ck` is all that is left without `www.`.
    expect(allowedFetchHost("www.ck")).toBeNull();
  });

  it("reads internationalized hosts by their ASCII form", () => {
    expect(allowedFetchHost("https://münchen-tauchen.de")).toBe("xn--mnchen-tauchen-gsb.de");
    expect(allowedFetchHost("рф")).toBeNull();
    expect(allowedFetchHost("https://www.ビーチ.co.jp")).toBe("www.xn--7ck9azh.co.jp");
    expect(allowedFetchHost("https://co.jp")).toBeNull();
    expect(allowedFetchHost("https://ビーチ.co.jp")).toBe("xn--7ck9azh.co.jp");
  });

  it("keeps the behaviour for an unknown ending: a name under it is allowed, the ending is not", () => {
    expect(allowedFetchHost("bluereef.zzz")).toBe("bluereef.zzz");
    expect(allowedFetchHost("zzz")).toBeNull();
    expect(allowedFetchHost("www.zzz")).toBeNull();
  });

  it("keeps refusing hosts that are not names at all", () => {
    for (const input of ["a..com", "a_b.com", "..", "www.", "www..com"]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
    expect(allowedFetchHost("bluereef.com.")).toBe("bluereef.com");
  });
});

describe("webFetchTool", () => {
  it("restricts fetching to the given host, with bounded uses and page size", () => {
    expect(webFetchTool("https://www.bluereefdivers.com")).toEqual({
      type: "web_fetch_20260209",
      name: "web_fetch",
      allowed_domains: ["www.bluereefdivers.com"],
      max_uses: 8,
      max_content_tokens: 20_000,
    });
  });

  it("takes narrower limits", () => {
    expect(webFetchTool("bluereef.com", { maxUses: 2, maxContentTokens: 5000 })).toMatchObject({
      max_uses: 2,
      max_content_tokens: 5000,
    });
  });

  it("is null for a host it will not allow, so the caller goes dark instead of fetching anywhere", () => {
    expect(webFetchTool("http://localhost")).toBeNull();
  });
});
