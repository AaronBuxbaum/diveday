import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { YourDays } from "./YourDays";

/**
 * **Your days waits for a delivered link** (security review of layer r5-4,
 * F1). The link a public booking or a seat claim redirects to proves only that
 * someone typed a name and an address that match a person on file, so it
 * reaches none of that person's other days: the card is not drawn, and the
 * days are not even read. `actions.test.ts` beside the booking form and the
 * claim page prove both of those entries mint undelivered links.
 */

/** A database that fails the test if the card reads anything at all. */
const untouchable = new Proxy({} as AppDb, {
  get() {
    throw new Error("YourDays read the database on a link it must not open");
  },
});

function pageData(identityHeld: boolean): ReadyPageData {
  return {
    identityHeld,
    shop: { id: "00000000-0000-4000-8000-000000000001" },
    detail: { shop: { name: "Blue Mantis Divers", timezone: "America/New_York" } },
  } as unknown as ReadyPageData;
}

function render(input: { delivered: boolean; identityHeld: boolean }) {
  return YourDays({
    ready: {
      db: untouchable,
      token: "token",
      bookingId: "00000000-0000-4000-8000-000000000002",
      data: pageData(input.identityHeld),
      delivered: input.delivered,
    },
    locale: "en-US",
    t: diverTranslator("en-US"),
  });
}

describe("YourDays", () => {
  it("draws nothing on the link a booking or a claim redirected to", async () => {
    expect(await render({ delivered: false, identityHeld: false })).toBeNull();
  });

  it("draws nothing on a held seat, even from a delivered link", async () => {
    expect(await render({ delivered: true, identityHeld: true })).toBeNull();
  });
});
