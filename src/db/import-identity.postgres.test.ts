import { and, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { prepareContactImport } from "@/lib/import";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { commitContactImport } from "@/test/words-wiring";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { createPerson } from "./people";
import { cards, internalNotes, people, shops, userAccounts, waiverRecords } from "./schema";
import { seedDemo } from "./seed";

// PGlite cannot make an uncommitted insert invisible to the initial roster
// read while the same insert blocks this import's unique-email constraint.
describePostgres("import identity under concurrent creation", () => {
  it.each(["recognized", "assisted", "manual"] as const)(
    "refuses a different-name %s insert winner without attaching evidence",
    async (mode) => {
      const pg = await postgresTestDb();
      await seedDemo(pg.db, "lean");
      const [account] = await pg.db
        .select({ personId: userAccounts.personId, shopId: people.shopId })
        .from(userAccounts)
        .innerJoin(people, eq(people.id, userAccounts.personId))
        .innerJoin(shops, eq(shops.id, people.shopId))
        .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
      if (!account) throw new Error("expected seeded owner");
      const email = `concurrent-${mode}@example.com`;
      let release!: () => void;
      let inserted!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        inserted = resolve;
      });
      const winner = pg.connect().transaction(async (tx) => {
        const person = await createPerson(tx, {
          shopId: account.shopId,
          fullName: "Father Senior",
          email,
          phone: null,
          origin: "import",
        });
        inserted();
        await held;
        return person;
      });
      onTestFinished(async () => {
        release();
        await winner;
      });
      await Promise.race([ready, winner]);
      const prepared = prepareContactImport(
        `${mode === "manual" ? "Guest,Mailbox" : "full_name,email"},${mode === "assisted" ? "Extra" : "internal_notes"},certification_level,certification_number,waiver_accepted\nDifferent Child,${email},child facts,Open Water,CHILD-CARD,yes`,
        {
          today: "2026-11-16",
          ...(mode === "manual"
            ? { manual: { Guest: "full_name" as const, Mailbox: "email" as const } }
            : {}),
          ...(mode === "assisted"
            ? { assist: { headers: { Extra: "internal_notes" as const }, levels: {} } }
            : {}),
        },
      );
      const importing = commitContactImport(
        pg.connect(),
        account.shopId,
        prepared,
        account.personId,
      );
      onTestFinished(async () => {
        release();
        await Promise.allSettled([winner, importing]);
      });
      // The roster read saw no committed match; the new-person insert must
      // now be waiting on the real unique constraint, not a pre-check.
      await waitForLockWaiters(pg.db, 1);
      release();
      const person = await winner;
      await expect(importing).resolves.toMatchObject({
        peopleCreated: 0,
        peopleUpdated: 0,
        rowsSkipped: 1,
        identityConflicts: 1,
        cardsAdded: 0,
        waiversAdded: 0,
        notesAdded: 0,
      });
      const [stored] = await pg.db
        .select()
        .from(people)
        .where(and(eq(people.shopId, account.shopId), eq(people.id, person.id)));
      expect(stored.fullName).toBe("Father Senior");
      expect(await pg.db.select().from(cards).where(eq(cards.personId, person.id))).toHaveLength(0);
      expect(
        await pg.db.select().from(waiverRecords).where(eq(waiverRecords.personId, person.id)),
      ).toHaveLength(0);
      expect(
        await pg.db.select().from(internalNotes).where(eq(internalNotes.personId, person.id)),
      ).toHaveLength(0);
    },
  );

  it.each(["recognized", "assisted", "manual"] as const)(
    "rechecks a %s identity after waiting for a concurrent name change",
    async (mode) => {
      const pg = await postgresTestDb();
      await seedDemo(pg.db, "lean");
      const [account] = await pg.db
        .select({ personId: userAccounts.personId, shopId: people.shopId })
        .from(userAccounts)
        .innerJoin(people, eq(people.id, userAccounts.personId))
        .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
      if (!account) throw new Error("expected seeded owner");
      const email = `locked-${mode}@example.com`;
      const person = await createPerson(pg.db, {
        shopId: account.shopId,
        fullName: "Original Diver",
        email,
        phone: null,
        origin: "import",
      });
      const prepared = prepareContactImport(
        `${mode === "manual" ? "Guest,Mailbox" : "full_name,email"},${mode === "assisted" ? "Extra" : "internal_notes"}\nOriginal Diver,${email},wrong identity facts`,
        {
          today: "2026-11-16",
          ...(mode === "manual"
            ? { manual: { Guest: "full_name" as const, Mailbox: "email" as const } }
            : {}),
          ...(mode === "assisted"
            ? { assist: { headers: { Extra: "internal_notes" as const }, levels: {} } }
            : {}),
        },
      );
      const gate = await holdRowLock(
        pg,
        sql`update people set full_name = 'Different Person' where id = ${person.id} and shop_id = ${account.shopId}`,
      );
      const importing = commitContactImport(
        pg.connect(),
        account.shopId,
        prepared,
        account.personId,
      );
      onTestFinished(async () => {
        await gate.release();
        await Promise.allSettled([importing]);
      });
      await waitForLockWaiters(pg.db, 1);
      await gate.release();
      await expect(importing).resolves.toMatchObject({
        peopleUpdated: 0,
        rowsSkipped: 1,
        identityConflicts: 1,
        notesAdded: 0,
      });
      const [stored] = await pg.db
        .select()
        .from(people)
        .where(and(eq(people.id, person.id), eq(people.shopId, account.shopId)));
      expect(stored.fullName).toBe("Different Person");
      expect(
        await pg.db.select().from(internalNotes).where(eq(internalNotes.personId, person.id)),
      ).toHaveLength(0);
    },
  );
});
