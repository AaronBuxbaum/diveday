import { describe, expect, it } from "vitest";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  getDiverWaiverChannelStates,
  getDiverWaiverRequestStatus,
  recordWaiverDelivery,
} from "./waivers-delivery-status";
import { issueWaiverRequest } from "./waivers-requests";
import { waiverContextFor } from "./waivers-test-fixtures";

/**
 * How a signing request reached the diver, as the diver record reads it: one
 * state per channel on the link that is outstanding, and one status overall.
 * The delivery webhooks that write provider verdicts are pinned in
 * `notifications.test.ts`; this file pins the two readers against the writer.
 */

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

async function outstandingLink() {
  const { db, shop, booking, person } = await waiverContext();
  // The link is the newest request: the seed's own pending one carries the frozen instant.
  advanceClock();
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  return { db, shop, personId: person.id, recordId: issued.recordId };
}

describe("a request's delivery, per channel and overall", () => {
  it("says nothing was sent, on every channel, for a diver with no outstanding link", async () => {
    const { db, shop } = await waiverContext();
    const nobody = "00000000-0000-4000-8000-000000000000";
    expect(await getDiverWaiverChannelStates(db, shop.id, nobody)).toEqual({
      email: "unknown",
      text: "unknown",
      link: "unknown",
    });
    expect(await getDiverWaiverRequestStatus(db, shop.id, nobody)).toBe("not_sent");
  });

  /** A staffer taking the URL is not a delivery: the link reads copied, never sent. */
  it("reads a copied link as copied, not as a message that went", async () => {
    const { db, shop, personId, recordId } = await outstandingLink();
    await recordWaiverDelivery(db, {
      shopId: shop.id,
      waiverRecordId: recordId,
      channel: "link",
      delivery: { status: "sent" },
    });
    expect((await getDiverWaiverChannelStates(db, shop.id, personId)).link).toBe("copied");
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("link_copied");
  });

  it("keeps the email's send when a link is copied after it", async () => {
    const { db, shop, personId, recordId } = await outstandingLink();
    for (const channel of ["email", "link"] as const) {
      await recordWaiverDelivery(db, {
        shopId: shop.id,
        waiverRecordId: recordId,
        channel,
        delivery: { status: "sent", providerMessageId: `${channel}-1` },
      });
    }
    const states = await getDiverWaiverChannelStates(db, shop.id, personId);
    expect(states).toMatchObject({ email: "sent", link: "copied", text: "unknown" });
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("not_signed");
  });

  it("says a failed send failed, and a second attempt on the channel replaces it", async () => {
    const { db, shop, personId, recordId } = await outstandingLink();
    await recordWaiverDelivery(db, {
      shopId: shop.id,
      waiverRecordId: recordId,
      channel: "text",
      delivery: { status: "failed", detail: "unreachable" },
    });
    expect((await getDiverWaiverChannelStates(db, shop.id, personId)).text).toBe("failed");
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("failed");

    await recordWaiverDelivery(db, {
      shopId: shop.id,
      waiverRecordId: recordId,
      channel: "text",
      delivery: { status: "sent", providerMessageId: "sms-2" },
    });
    expect((await getDiverWaiverChannelStates(db, shop.id, personId)).text).toBe("sent");
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("not_signed");
  });
});
