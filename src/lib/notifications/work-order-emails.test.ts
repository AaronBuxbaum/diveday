import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import {
  gearServiceDueEmail,
  gearServiceDueText,
  workOrderReadyEmail,
  workOrderReadyText,
} from "./work-order-emails";

const REGULATOR = { kind: "regulator" as const, brandModel: "Apeks XTX200" };

describe("the ready message", () => {
  it("names the shop, the gear and the work performed, and escapes what staff typed", () => {
    const email = workOrderReadyEmail({
      locale: "en-US",
      diverName: "Maya Torres",
      shopName: "Blue <Mantis>",
      ticketNumber: 12,
      pieces: [REGULATOR, { kind: "bcd" }],
      workPerformed: "Serviced both stages.\n\nReplaced the <HP> seat.",
    });
    expect(email.text).toContain("Blue <Mantis>");
    // The number on the claim tag, so the counter finds the right shelf.
    expect(email.subject).toContain("#12");
    expect(email.text).toContain("ticket #12");
    expect(email.text).toContain("regulator (Apeks XTX200) and BCD");
    expect(email.text).toContain("Replaced the <HP> seat.");
    expect(email.html).toContain("Blue &lt;Mantis&gt;");
    expect(email.html).toContain("Replaced the &lt;HP&gt; seat.");
    expect(email.html).not.toContain("<HP>");
  });

  it("reads in the customer's own language", () => {
    const email = workOrderReadyEmail({
      locale: "es-ES",
      diverName: "Maya Torres",
      shopName: "Blue Mantis",
      ticketNumber: 3,
      pieces: [{ kind: "dive_computer" }],
    });
    expect(email.text).toContain("computadora de buceo");
  });

  it("keeps a text short: the work performed is cut, never the shop or the gear", () => {
    const text = workOrderReadyText(diverTranslator("en-US"), "en-US", {
      shopName: "Blue Mantis",
      ticketNumber: 12,
      pieces: [REGULATOR],
      workPerformed: "x".repeat(600),
    });
    expect(text).toContain("Blue Mantis");
    expect(text).toContain("regulator (Apeks XTX200)");
    expect(text).toContain("#12");
    expect(text.length).toBeLessThan(400);
  });
});

describe("the service reminder", () => {
  it("names the clock, the piece and the day, and carries the courtesy way out", () => {
    const email = gearServiceDueEmail({
      locale: "en-US",
      diverName: "Maya Torres",
      shopName: "Blue Mantis",
      piece: { kind: "tank" },
      clock: "hydro_test",
      dueOn: "2026-08-15",
      unsubscribeUrl: "https://diveday.test/unsubscribe/abc",
    });
    expect(email.text).toMatch(/hydro/i);
    expect(email.text).toContain("Aug");
    expect(email.text).toContain("https://diveday.test/unsubscribe/abc");
    expect(email.html).toContain('href="https://diveday.test/unsubscribe/abc"');
  });

  it("as a text, leads with the shop", () => {
    const text = gearServiceDueText(diverTranslator("en-US"), "en-US", {
      shopName: "Blue Mantis",
      piece: REGULATOR,
      clock: "service",
      dueOn: "2026-08-15",
    });
    expect(text.startsWith("Blue Mantis: ")).toBe(true);
    expect(text).toContain("regulator (Apeks XTX200)");
  });
});
