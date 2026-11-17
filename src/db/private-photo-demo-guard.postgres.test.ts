import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { DEMO_PRIVATE_PHOTO_CLEANUP_REQUIRED } from "./private-photo-demo-guard";
import { people, privatePersonPhotoUploads, shops } from "./schema";
import { clearDemoSchedule, deleteDemoShopCascade } from "./seed";

describePostgres("demo cleanup and photo staging", () => {
  it.each(["reset", "reap"] as const)(
    "%s refuses after an earlier stage commits",
    async (operation) => {
      const pg = await postgresTestDb();
      const [shop] = await pg.db
        .insert(shops)
        .values({
          name: "Photo demo",
          slug: `photo-demo-${operation}`,
          timezone: "UTC",
          isDemo: true,
        })
        .returning();
      if (!shop) throw new Error("shop missing");
      const [person] = await pg.db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Photo Diver" })
        .returning();
      if (!person) throw new Error("person missing");
      let acquired!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stage = pg.connect().transaction(async (tx) => {
        await lockBoardingCertificationEvidence(tx, shop.id, "rewrite");
        await tx.insert(privatePersonPhotoUploads).values({
          shopId: shop.id,
          personId: person.id,
          url: "https://media.example.com/private-person-photos/example.jpg",
          state: "staged",
        });
        acquired();
        await held;
      });
      await locked;
      const destructive =
        operation === "reset"
          ? clearDemoSchedule(pg.connect(), shop.id)
          : deleteDemoShopCascade(pg.connect(), shop.id);
      const outcome = destructive.then(
        () => null,
        (error: unknown) => error,
      );
      try {
        await waitForLockWaiters(pg.db, 1);
      } finally {
        release();
        await stage;
      }
      expect(await outcome).toEqual(
        expect.objectContaining({ message: DEMO_PRIVATE_PHOTO_CLEANUP_REQUIRED }),
      );
      expect(await pg.db.select().from(people).where(eq(people.id, person.id))).toHaveLength(1);
      expect(
        await pg.db
          .select()
          .from(privatePersonPhotoUploads)
          .where(eq(privatePersonPhotoUploads.personId, person.id)),
      ).toHaveLength(1);
    },
  );
});
