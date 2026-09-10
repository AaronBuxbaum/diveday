// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { verifyShelfToken } from "./person-shelf-tokens";
import { people, personRoles } from "./schema";
import { sendShelfLink } from "./shelf-link-send";

/**
 * **Sending a diver their shelf link, and where it is allowed to go.**
 *
 * The link opens one person's file, so the only safe recipient is the address
 * already on the record — never one a staffer types, and never one a caller
 * passes. The cases below are that rule and the three ways it declines.
 */

const APP_ORIGIN = "https://diveday.test";

vi.mock("@/lib/notifications/app-url", () => ({
  publicAppUrl: () => APP_ORIGIN,
}));

const sent = vi.fn();
vi.mock("./notifications", () => ({
  sendAndRecordNotification: (_db: unknown, notification: unknown) => {
    sent(notification);
    return Promise.resolve({ status: "sent", providerMessageId: "test" });
  },
}));

beforeEach(() => sent.mockClear());

/**
 * `seededShopContext` hands every case in this file the same shop, and
 * `people_shop_email_unique` is per shop — so each fixture takes the next
 * address rather than a name-derived one.
 */
let seq = 0;

function nextEmail() {
  seq += 1;
  return `shelf.send.${seq}@example.com`;
}

async function diver(db: AppDb, shopId: string, email: string | null) {
  seq += 1;
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName: `Diver ${seq}`, email })
    .returning({ id: people.id });
  if (!row) throw new Error("diver fixture insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  return row.id;
}

describe("sending the shelf link", () => {
  it("mails a working link to the address on the record", async () => {
    const { db, shop } = await seededShopContext();
    const email = nextEmail();
    const personId = await diver(db, shop.id, email);

    expect(await sendShelfLink(db, { shopId: shop.id, personId })).toBe("sent");
    expect(sent).toHaveBeenCalledTimes(1);

    const notification = sent.mock.calls[0]?.[0] as {
      kind: string;
      to: string;
      shelfUrl: string;
      personId: string;
      tokenId: string;
    };
    expect(notification.kind).toBe("shelf_link");
    expect(notification.to).toBe(email);
    expect(notification.personId).toBe(personId);

    // The link in the mail is the one that works — and it is a shelf link, not
    // a booking one.
    const token = new URL(notification.shelfUrl).pathname.replace("/shelf/", "");
    expect(notification.shelfUrl.startsWith(`${APP_ORIGIN}/shelf/`)).toBe(true);
    expect(await verifyShelfToken(db, { token })).toMatchObject({
      shopId: shop.id,
      personId,
      tokenId: notification.tokenId,
    });
  });

  it("declines with nowhere to send, and mints nothing", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id, null);
    expect(await sendShelfLink(db, { shopId: shop.id, personId })).toBe("no_email");
    expect(sent).not.toHaveBeenCalled();
  });

  it("declines for a record this shop does not have", async () => {
    const { db, shop } = await seededShopContext();
    const other = await seededShopContext();
    const strangerId = await diver(other.db, other.shop.id, "stranger@example.com");
    expect(await sendShelfLink(db, { shopId: shop.id, personId: strangerId })).toBe("unavailable");
    expect(sent).not.toHaveBeenCalled();
  });

  it("declines for a deleted record", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id, nextEmail());
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, personId));
    expect(await sendShelfLink(db, { shopId: shop.id, personId })).toBe("unavailable");
    expect(sent).not.toHaveBeenCalled();
  });
});
