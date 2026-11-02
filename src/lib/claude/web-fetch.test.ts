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

  // Every root the hand-kept list refused before the Public Suffix List replaced it (ADR
  // 20261102-public-suffix-list). A `tldts` upgrade that drops one from the list fails here, so
  // it moves to SHARED_SERVICE_ROOTS rather than silently widening an allowance.
  const formerRoots = [
    ..."co.uk org.uk me.uk ltd.uk plc.uk net.uk ac.uk gov.uk com.au net.au org.au co.nz".split(" "),
    ..."org.nz co.za co.jp ne.jp or.jp co.kr com.br com.mx com.ar com.co com.pe com.ph".split(" "),
    ..."com.my com.sg com.hk com.tw com.cn co.id co.th com.tr com.eg com.ec".split(" "),
    ..."com.do com.pa com.gt co.cr co.il co.in com.es com.pt com.fj com.vn".split(" "),
    ..."com.mt com.cy gr.com".split(" "),
    ..."wixsite.com wix.com squarespace.com square.site weebly.com wordpress.com".split(" "),
    ..."blogspot.com blogger.com github.io gitlab.io netlify.app vercel.app pages.dev".split(" "),
    ..."webflow.io godaddysites.com carrd.co myshopify.com herokuapp.com web.app".split(" "),
    ..."firebaseapp.com azurewebsites.net cloudfront.net amazonaws.com sites.google.com".split(" "),
    ..."google.com facebook.com instagram.com linktr.ee wa.me tripadvisor.com".split(" "),
  ];

  it("refuses every root the hand-kept list refused, bare or behind www, and allows a tenant under it", () => {
    for (const root of formerRoots) {
      expect(allowedFetchHost(root), root).toBeNull();
      expect(allowedFetchHost(`www.${root}`), `www.${root}`).toBeNull();
      expect(allowedFetchHost(`bluereef.${root}`), `bluereef.${root}`).toBe(`bluereef.${root}`);
    }
  });

  it("refuses a public suffix the hand-kept list never named, wildcard rules included", () => {
    for (const input of [
      // Changed decision: accepted before. `*.ck` makes `b.ck` a suffix, not a registrable site.
      "b.ck",
      // Changed decision: accepted before. One leading `www.` is set aside before the suffix
      // lookup, so `www.b.ck` is judged as `b.ck`; refusing it is the safer side of the
      // ambiguity, and a shop there pastes its bare host instead.
      "www.b.ck",
      // Changed decision: accepted before. `*.kawasaki.jp` makes every child a suffix.
      "foo.kawasaki.jp",
      // Changed decision: accepted before. Private-section platform suffixes.
      "s3.amazonaws.com",
      "appspot.com",
      "www.ck",
      "xn--p1ai",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
  });

  it("allows a registrable host under a wildcard, an exception rule, a platform or an IDN", () => {
    expect(allowedFetchHost("shop.b.ck")).toBe("shop.b.ck");
    // `!city.kawasaki.jp` is an exception to `*.kawasaki.jp`: a registrable domain.
    expect(allowedFetchHost("city.kawasaki.jp")).toBe("city.kawasaki.jp");
    expect(allowedFetchHost("bluereef.appspot.com")).toBe("bluereef.appspot.com");
    expect(allowedFetchHost("bluereef.s3.amazonaws.com")).toBe("bluereef.s3.amazonaws.com");
    // IDNs are judged and returned in their ASCII form, as WHATWG URL produces it.
    expect(allowedFetchHost("https://bücher.de/")).toBe("xn--bcher-kva.de");
    expect(allowedFetchHost("магазин.рф")).toBe("xn--80aairftm.xn--p1ai");
    // A shared service's root is matched exactly; a shop's own subdomain is fine.
    expect(allowedFetchHost("bluereef.dropbox.com")).toBe("bluereef.dropbox.com");
    // A shop label under an ordinary registrable domain is not a wildcard child.
    expect(allowedFetchHost("shop.bluereefdivers.co.uk")).toBe("shop.bluereefdivers.co.uk");
    expect(allowedFetchHost("www.bluereefdivers.com")).toBe("www.bluereefdivers.com");
    // `!city.kobe.jp` is an exception to `*.kobe.jp`, so its children are one site.
    expect(allowedFetchHost("city.kobe.jp")).toBe("city.kobe.jp");
  });

  it("refuses the parent of a wildcard rule, whose every child is a suffix", () => {
    // Changed decision (independent security review): allowed before, though each child is
    // a registry (`x.sch.uk`, `a.kobe.jp`, `ec2-1-2-3-4.compute-1.amazonaws.com`).
    for (const input of [
      "sch.uk",
      "www.sch.uk",
      "kobe.jp",
      "kawasaki.jp",
      "nagoya.jp",
      "compute.amazonaws.com",
      "compute-1.amazonaws.com",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
  });

  it("refuses a host under a TLD the list does not know", () => {
    // Changed decision (independent security review): two labels under an unknown TLD were
    // one site before; no public registry stands behind them, so they are refused.
    for (const input of [
      "shop.unknowntld",
      "www.unknowntld",
      "intranet.corp",
      "printer.intranet",
      "host.localdomain",
      "kubernetes.default.svc",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
  });

  it("refuses the root of a shared file, archive or redirect service", () => {
    for (const input of [
      "web.archive.org",
      "raw.githubusercontent.com",
      "storage.googleapis.com",
      "googleusercontent.com",
      "docs.google.com",
      "dropbox.com",
      "www.dropbox.com",
      "dl.dropboxusercontent.com",
      "pastebin.com",
      // Changed decision (independent security review): allowed before.
      "m.facebook.com",
      "l.facebook.com",
      "fb.com",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
  });

  it("normalizes a trailing dot, case and confusable characters before judging the host", () => {
    expect(allowedFetchHost("BlueReef.com.")).toBe("bluereef.com");
    expect(allowedFetchHost("bluereef.ｃｏｍ")).toBe("bluereef.com");
    expect(allowedFetchHost("ⓦⓦⓦ.wixsite.com")).toBeNull();
    expect(allowedFetchHost("bluereef.com..")).toBeNull();
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
      "shop.localhost",
      // Changed decision: accepted before. Special-use names (RFC 6761, 7686, 9476).
      "shop.example",
      "shop.onion",
      "shop.alt",
      "router.home.arpa",
      // IPv4 in any form WHATWG URL accepts is normalized to four labels and refused.
      "0x7f.1",
      "127.1",
      "2130706433",
      "http://0x7f000001/",
      "http://[::ffff:127.0.0.1]/",
      "https://a@bluereef.com",
      "blob:https://bluereef.com",
      "https://blue_reef.com",
    ]) {
      expect(allowedFetchHost(input), input).toBeNull();
    }
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
