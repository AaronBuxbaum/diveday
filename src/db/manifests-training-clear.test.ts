import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext, markSeat } from "@/test/training-mark-context";
import { getTripManifest } from "./manifests";
import { people } from "./schema";
import { clearTrainingDive } from "./training-marks";

const fileCtx = fileScopedShopContext();

it("shows why a training mark was cleared and attributes the actual clearing staff member", async () => {
  const f = await charterContext(fileCtx);
  expect((await markSeat(f)).ok).toBe(true);
  expect(
    await clearTrainingDive(f.db, {
      shopId: f.shop.id,
      bookingId: f.seat.id,
      actorPersonId: f.owner,
    }),
  ).toEqual({ ok: true, changed: true });
  const [owner] = await f.db.select().from(people).where(eq(people.id, f.owner));
  if (!owner) throw new Error("fixture owner missing");
  const manifest = await getTripManifest(f.db, f.shop.id, f.charter.id);
  expect(manifest?.divers.find((row) => row.bookingId === f.seat.id)?.trainingMarkCleared).toEqual({
    reason: "forms_owed",
    byName: owner.fullName,
  });
});
