import { describe, expect, it } from "vitest";
import { people, personRoles } from "@/db/schema";
import { publicAppUrl } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { sendDiverSignInMail } from "./diver-sign-in";

const ctx = fileScopedShopContext({ realShop: true });

async function diver() {
  const [person] = await ctx.db
    .insert(people)
    .values({ shopId: ctx.shop.id, fullName: "Ana Reyes", email: "ana-mail@example.com" })
    .returning();
  if (!person) throw new Error("fixture insert failed");
  await ctx.db.insert(personRoles).values({ personId: person.id, role: "diver" });
  return person;
}

/** ADR 20261125-diver-sign-in: the link goes to the address on file, and nowhere for a stranger. */
describe("diver sign-in delivery", () => {
  it("mails the shop's person at that address a canonical one-tap link", async () => {
    const ana = await diver();
    const mail = fakeEmail();
    await sendDiverSignInMail(
      ctx.db,
      { shop: ctx.shop, email: "Ana-Mail@example.com" },
      mail.provider,
    );
    expect(mail.sent).toHaveLength(1);
    const notice = mail.sent[0];
    if (notice?.kind !== "diver_sign_in_request") throw new Error("wrong kind");
    expect(notice).toMatchObject({
      to: "ana-mail@example.com",
      personId: ana.id,
      shopId: ctx.shop.id,
    });
    const url = new URL(notice.signInUrl);
    expect(url.origin).toBe(publicAppUrl());
    expect(url.pathname).toMatch(/^\/diver-sign-in\/[A-Za-z0-9_-]{43}$/);
  });

  it("sends nothing for an address the shop does not hold", async () => {
    await diver();
    const mail = fakeEmail();
    await sendDiverSignInMail(
      ctx.db,
      { shop: ctx.shop, email: "stranger@example.com" },
      mail.provider,
    );
    expect(mail.sent).toEqual([]);
  });
});
