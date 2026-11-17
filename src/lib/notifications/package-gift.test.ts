import { describe, expect, it } from "vitest";
import { packageGiftEmail } from "./package-gift";

const input = {
  recipientName: "Rita Recipient",
  buyerName: "Gil <Giver>",
  shopName: "Blue Mantis",
  packageName: "Ten-dive card",
  diveCount: 10,
  bookUrl: "https://dive.day/s/blue-mantis",
};

describe("packageGiftEmail (#4629)", () => {
  it("names the giver, the dives and the shop, and says there is nothing to claim", () => {
    const email = packageGiftEmail({ ...input, locale: "en-US" });
    expect(email.subject).toBe("Gil gave you 10 dives at Blue Mantis");
    expect(email.text).toContain("Rita, Gil bought you Ten-dive card at Blue Mantis");
    expect(email.text).toContain("They’re on this email.");
    expect(email.text).toContain("https://dive.day/s/blue-mantis");
    expect(email.html).toContain('href="https://dive.day/s/blue-mantis"');
  });

  it("speaks Spanish, and leaves the link out when there is no public origin", () => {
    const email = packageGiftEmail({ ...input, locale: "es-ES", bookUrl: undefined });
    expect(email.subject).toBe("Gil te regaló 10 inmersiones en Blue Mantis");
    expect(email.html).not.toContain("<a ");
  });
});
