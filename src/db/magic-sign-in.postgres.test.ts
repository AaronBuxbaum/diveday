import { Client } from "pg";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { mintDemoLink } from "../../scripts/demo-link";
import { startShopBrowser } from "../../scripts/shop-browser";
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

describePostgres("operator demo handoff integration", () => {
  it("mints through the authenticated browser, supersedes and consumes only once", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Operator sample", slug: "operator-sample", timezone: "UTC", isDemo: true })
      .returning();
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Sample owner" })
      .returning();
    const [account] = await pg.db
      .insert(userAccounts)
      .values({ personId: person.id, email: "owner@sample.demo.invalid", status: "active" })
      .returning();
    await pg.db.insert(personRoles).values({ personId: person.id, role: "owner" });
    const browser = await startShopBrowser(pg.url);
    try {
      const launch = new URL(browser.url);
      const endpoint = new URL("/demo-link?slug=operator-sample", launch.origin);
      const headers = { Origin: launch.origin, Authorization: `Bearer ${launch.hash.slice(1)}` };
      expect((await fetch(endpoint, { method: "POST" })).status).toBe(403);
      const mint = async () => {
        const response = await fetch(endpoint, { method: "POST", headers });
        expect(response.status).toBe(200);
        const result = (await response.json()) as { url: string; expiresAt: string };
        return new URL(result.url).pathname.split("/").pop() ?? "";
      };
      const first = await mint();
      const second = await mint();
      const redeem = (token: string) =>
        startMagicSignIn(pg.db, { token, previousHandle: null }, async () => "session");
      expect((await redeem(first)).status).toBe("invalid");
      const attempts = await Promise.all([redeem(second), redeem(second)]);
      expect(attempts.map((value) => value.status).sort()).toEqual(["invalid", "signed_in"]);
    } finally {
      await browser.close();
    }
    // A real address must never be offered an operator-generated link, even on a demo-flagged shop.
    const client = new Client({ connectionString: pg.url });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("update user_accounts set email = $2 where id = $1", [
        account.id,
        "real@example.com",
      ]);
      expect(await mintDemoLink(client, shop.slug)).toBeNull();
    } finally {
      await client.query("rollback");
      await client.end();
    }
  });
});

describePostgres("magic sign-in and staff writer lock order", () => {
  it("completes while a shop-first staff writer locks the same person", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Staff race", slug: "staff-race", timezone: "UTC", isDemo: false })
      .returning();
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Staff owner" })
      .returning();
    const [account] = await pg.db
      .insert(userAccounts)
      .values({
        personId: person.id,
        email: "staff-race@example.com",
        status: "active",
        emailVerified: true,
        emailVerifiedAt: nowDate(),
      })
      .returning();
    await pg.db.insert(personRoles).values({ personId: person.id, role: "owner" });
    const issued = await issueMagicSignIn(pg.db, account.email);
    if (!issued) throw new Error("no eligible account");
    const writer = new Client({ connectionString: pg.url, statement_timeout: 5000 });
    await writer.connect();
    try {
      await writer.query("begin");
      // Same first lock as setStaffRoles/removeStaffMember (demo-account-guard.ts).
      await writer.query("select id from shops where id = $1 for no key update", [shop.id]);
      let persisted!: () => void;
      let releasePersist!: () => void;
      const reachedPersist = new Promise<void>((resolve) => {
        persisted = resolve;
      });
      const persistGate = new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
      const completion = startMagicSignIn(
        pg.connect(),
        { token: issued.token, previousHandle: null },
        async () => {
          persisted();
          await persistGate;
          return "session";
        },
      );
      const observed = Promise.allSettled([completion]);
      const waiting = waitForLockWaiters(pg.db, 1);
      // Old code waits on the shop; fixed code reaches persistence while retaining its person lock.
      await Promise.race([reachedPersist, waiting]);
      const personWrite = (async () => {
        await writer.query("select id from people where id = $1 for no key update", [person.id]);
        await writer.query("commit");
      })();
      // In either path, prove contention before releasing authentication's persistence gate.
      try {
        await waiting;
      } finally {
        releasePersist();
      }
      const [write] = await Promise.allSettled([personWrite]);
      if (write.status === "rejected") await writer.query("rollback");
      const [signedIn] = await observed;
      expect(write.status).toBe("fulfilled");
      expect(signedIn.status).toBe("fulfilled");
      if (signedIn.status === "fulfilled") expect(signedIn.value.status).toBe("signed_in");
    } finally {
      await writer.query("rollback");
      await writer.end();
    }
  });
});
