import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { people, shops, userAccounts } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { publicAppUrl } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { sendMagicSignInMail } from "./store";

const ctx = fileScopedShopContext();
async function fixture() {
  const [account] = await ctx.db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
  const [person] = await ctx.db.select().from(people).where(eq(people.id, account.personId));
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, person.shopId));
  await ctx.db
    .update(userAccounts)
    .set({ email: "verified@example.com", emailVerified: true, emailVerifiedAt: nowDate() })
    .where(eq(userAccounts.id, account.id));
  return { account, person };
}
describe("deferred email sign-in delivery", () => {
  it("delivers the correct purpose and canonical link only to the verified account address", async () => {
    const { account } = await fixture();
    const mail = fakeEmail();
    await sendMagicSignInMail(ctx.db, "verified@example.com", mail.provider);
    expect(mail.sent).toHaveLength(1);
    const notice = mail.sent[0];
    expect(notice.kind).toBe("magic_sign_in_request");
    if (notice.kind !== "magic_sign_in_request") throw new Error("wrong purpose");
    expect(notice.to).toBe("verified@example.com");
    expect(notice.userAccountId).toBe(account.id);
    expect(new URL(notice.signInUrl).origin).toBe(publicAppUrl());
    expect(new URL(notice.signInUrl).pathname).toMatch(
      /^\/email-sign-in\/[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/,
    );
  });
  it.each(["missing", "unverified", "disabled", "demo", "deleted"])(
    "sends nothing for %s",
    async (reason) => {
      const { account, person } = await fixture();
      const mail = fakeEmail();
      if (reason === "unverified")
        await ctx.db
          .update(userAccounts)
          .set({ emailVerifiedAt: null, emailVerified: false })
          .where(eq(userAccounts.id, account.id));
      if (reason === "disabled")
        await ctx.db
          .update(userAccounts)
          .set({ status: "disabled" })
          .where(eq(userAccounts.id, account.id));
      if (reason === "demo")
        await ctx.db.update(shops).set({ isDemo: true }).where(eq(shops.id, person.shopId));
      if (reason === "deleted")
        await ctx.db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, person.id));
      await sendMagicSignInMail(
        ctx.db,
        reason === "missing" ? "missing@example.com" : "verified@example.com",
        mail.provider,
      );
      expect(mail.sent).toEqual([]);
    },
  );
});
