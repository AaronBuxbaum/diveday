import type { AppDb } from "@/db/client";
import { walletPasses, walletPassRegistrations } from "@/db/schema";
import { walletContentFixture } from "@/test/wallet-credentials";

export async function walletRegistrationRetentionFixture(
  fixture: { db: AppDb; shop: { id: string }; entry: { booking: { id: string } } },
  at: Date,
  n: 0 | 1,
) {
  const { db, shop, entry } = fixture;
  const [pass] = await db
    .insert(walletPasses)
    .values({
      shopId: shop.id,
      bookingId: entry.booking.id,
      platform: n === 0 ? "apple" : "google",
      locale: "en-US",
      authenticationTokenHash: n === 0 ? "test-hash" : null,
      googleObjectId: n === 1 ? "test-object" : null,
      contentHash: "test-content",
      contentJson: { ...walletContentFixture(), expirationDate: at.toISOString() },
    })
    .returning();
  const [registration] = await db
    .insert(walletPassRegistrations)
    .values({
      shopId: shop.id,
      passId: pass.id,
      deviceLibraryIdentifier: `device-${n}`,
      pushToken: "test-push-token",
    })
    .returning({ id: walletPassRegistrations.id });
  return registration.id;
}
