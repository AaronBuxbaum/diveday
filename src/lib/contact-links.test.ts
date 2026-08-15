import { describe, expect, it } from "vitest";
import { mailtoHref, telHref } from "./contact-links";

describe("telHref", () => {
  it("strips what a dialler refuses from a number a shop typed to be read", () => {
    // The regression this module exists for: two surfaces shipped the stored
    // string straight into the href, and a `tel:` carrying spaces and
    // parentheses is refused outright by several diallers — so the tap did
    // nothing on the one surface (a diver on a dock, looking for the boat)
    // where it most needed to work.
    expect(telHref("+1 (305) 555-0134")).toBe("tel:+13055550134");
  });

  it("keeps a leading plus, because that is what makes it diallable abroad", () => {
    expect(telHref("+44 20 7946 0958")).toBe("tel:+442079460958");
  });

  it("leaves an already-clean number alone", () => {
    expect(telHref("3055550134")).toBe("tel:3055550134");
  });
});

describe("mailtoHref", () => {
  it("does not encode the address itself", () => {
    // Encoding the `@` is what makes some clients open a blank compose window.
    expect(mailtoHref("nora@example.com")).toBe("mailto:nora@example.com");
  });

  it("encodes a subject and body, where a shop's own words would truncate the draft", () => {
    const href = mailtoHref("nora@example.com", { subject: "Trip & kit", body: "Hi Nora" });
    expect(href).toBe("mailto:nora@example.com?subject=Trip%20%26%20kit&body=Hi%20Nora");
  });

  it("renders a space as %20 rather than the + a mailto body shows literally", () => {
    expect(mailtoHref("a@b.com", { subject: "two words" })).toContain("subject=two%20words");
    expect(mailtoHref("a@b.com", { subject: "two words" })).not.toContain("+");
  });

  it("adds no query at all when there is nothing to prefill", () => {
    expect(mailtoHref("a@b.com", {})).toBe("mailto:a@b.com");
  });
});
