import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OpenPaymentDispute } from "@/db/payment-disputes";
import { staffTranslator } from "@/i18n/staff-messages";
import { OrderDisputeBanner, OrderMeta } from "./OrderMeta";

const t = staffTranslator("en-US");

describe("OrderMeta", () => {
  function metaText(
    createdBy: { name: string | null; online: boolean },
    rentalTicketId = null as string | null,
  ) {
    return renderToStaticMarkup(
      OrderMeta({
        order: { createdAt: new Date("2026-10-09T12:00:00Z") },
        personId: "p-1",
        createdBy,
        rentalTicketId,
        shopSlug: "blue-mantis",
        locale: "en-US",
        timezone: "UTC",
        t,
      }),
    );
  }

  it("says a diver's own purchase was bought online, never that they raised it", () => {
    const html = metaText({ name: "Ola Online", online: true });
    expect(html).toContain("bought online");
    expect(html).not.toContain("by Ola Online");
  });

  it("names the staffer who raised an order", () => {
    expect(metaText({ name: "Dana Desk", online: false })).toContain("by Dana Desk");
  });

  it("links the counter-rental ticket an invoice billed for, and only then", () => {
    expect(metaText({ name: null, online: false }, "ticket-1")).toContain(
      "/shop/blue-mantis/gear/rentals/ticket-1",
    );
    expect(metaText({ name: null, online: false })).not.toContain("/gear/rentals/");
  });
});

describe("OrderDisputeBanner", () => {
  const dispute = {
    amountCents: 5_000,
    currency: "usd",
    evidenceDueBy: new Date("2026-10-17T12:00:00Z"),
  } as OpenPaymentDispute;

  it("names the amount and the evidence deadline", () => {
    const html = renderToStaticMarkup(
      OrderDisputeBanner({ dispute, timezone: "UTC", locale: "en-US", t }) ?? <></>,
    );
    expect(html).toContain("$50.00");
  });

  it("renders nothing without a dispute", () => {
    expect(OrderDisputeBanner({ dispute: null, timezone: "UTC", locale: "en-US", t })).toBeNull();
  });
});
