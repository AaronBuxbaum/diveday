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
