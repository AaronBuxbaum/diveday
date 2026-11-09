import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { issueMagicSignIn, startMagicSignIn } from "./magic-sign-in";
import { people, personRoles, shops, userAccounts } from "./schema";

describePostgres("magic sign-in contention", () => {
  it("spends one token once across concurrent sessions", async () => {
    const pg = await postgresTestDb();
    {
      const [shop] = await pg.db
        .insert(shops)
        .values({
          name: "Magic contention",
          slug: "magic-contention",
          timezone: "UTC",
          isDemo: false,
        })
        .returning();
      const [person] = await pg.db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Magic owner" })
        .returning();
      const [account] = await pg.db
        .insert(userAccounts)
        .values({
          personId: person.id,
          email: "magic@example.com",
          status: "active",
          emailVerified: true,
          emailVerifiedAt: nowDate(),
        })
        .returning();
      await pg.db.insert(personRoles).values({ personId: person.id, role: "owner" });
      const issued = await issueMagicSignIn(pg.db, account.email);
      if (!issued) throw new Error("expected eligible account");
      const statuses = await Promise.all(
        [1, 2].map(() =>
          startMagicSignIn(
            pg.db,
            { token: issued.token, previousHandle: null },
            async () => "session",
          ),
        ),
      );
      expect(statuses.map((result) => result.status).sort()).toEqual(["invalid", "signed_in"]);
    }
  });
});
