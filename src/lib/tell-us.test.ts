import { describe, expect, it } from "vitest";
import { tellUsMailto, tellUsPath } from "./tell-us";

describe("tellUsPath", () => {
  it("keeps the path and drops a query string that could hold a diver's name", () => {
    expect(tellUsPath("/shop/blue-mantis/divers?q=Ana%20Lopez")).toBe("/shop/blue-mantis/divers");
  });

  it("drops a fragment", () => {
    expect(tellUsPath("/shop/blue-mantis/trips/abc#roster")).toBe("/shop/blue-mantis/trips/abc");
  });

  it("leaves a plain path alone", () => {
    expect(tellUsPath("/shop/blue-mantis")).toBe("/shop/blue-mantis");
  });
});

describe("tellUsMailto", () => {
  it("addresses support and encodes the subject and body for a mail app", () => {
    const href = tellUsMailto({
      to: "support@dive.day",
      subject: "From blue-mantis",
      body: "Page: /shop/blue-mantis/trips\n\n",
    });
    expect(href).toBe(
      "mailto:support@dive.day?subject=From%20blue-mantis&body=Page%3A%20%2Fshop%2Fblue-mantis%2Ftrips%0A%0A",
    );
  });

  it("cannot be pushed into extra headers by a crafted path", () => {
    const href = tellUsMailto({
      to: "support@dive.day",
      subject: "x",
      body: `Page: ${tellUsPath("/shop/a&cc=evil@example.com")}`,
    });
    expect(href).not.toContain("&cc=");
  });
});
