import { and, eq } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { bookings, mediaDeletionAttempts } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { retireRejectedRecapPhoto } from "./store";

const ctx = fileScopedShopContext();

it("keeps a rejected upload's permanent erasure attributable when storage is unavailable", async () => {
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  vi.stubEnv("MEDIA_AWS_ACCESS_KEY_ID", "");
  vi.stubEnv("MEDIA_AWS_SECRET_ACCESS_KEY", "");
  const { db, shop } = ctx;
  const [booking] = await db.select().from(bookings).where(eq(bookings.shopId, shop.id)).limit(1);
  if (!booking) throw new Error("missing booking fixture");
  const url = "https://diveday-media.s3.us-east-1.amazonaws.com/recap/rejected.jpg";
  await retireRejectedRecapPhoto(db, booking.id, url);
  const [attempt] = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(and(eq(mediaDeletionAttempts.shopId, shop.id), eq(mediaDeletionAttempts.url, url)));
  expect(attempt).toMatchObject({
    personId: booking.personId,
    purgeVersions: true,
    status: "failed",
  });
});
