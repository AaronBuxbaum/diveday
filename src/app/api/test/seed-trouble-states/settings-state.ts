import { NextResponse } from "next/server";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { shopBackupDeliveries, shopBackupDestinations } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";

/** Called only behind the existing trouble route's harness/secret/database gate. */
export async function settingsStateResponse(request: Request, db: AppDb) {
  const query = new URL(request.url).searchParams;
  if (!query.has("settingsState")) return null;
  if (query.get("settingsState") !== "backup-failed")
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  const shop = await getShopBySlug(db, query.get("shop") ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const now = nowDate();
  const succeededAt = new Date(now.getTime() - DAY_MS);
  await db
    .insert(shopBackupDestinations)
    .values({
      shopId: shop.id,
      endpoint: "https://backup-visual.example",
      region: "auto",
      bucket: "visual-backups",
      prefix: "diveday",
      accessKeyId: "VISUAL-EXAMPLE-ONLY",
      // An intentionally unreadable placeholder: no provider call or real credential.
      secretAccessKeySealed: "v1.visual.visual.visual",
      verifiedAt: succeededAt,
    })
    .onConflictDoUpdate({
      target: shopBackupDestinations.shopId,
      set: { verifiedAt: succeededAt },
    });
  await db.insert(shopBackupDeliveries).values([
    {
      shopId: shop.id,
      periodKey: "visual-success",
      trigger: "manual",
      status: "succeeded",
      objectKey: "visual/previous-success.zip",
      byteCount: 32000,
      startedAt: succeededAt,
      finishedAt: succeededAt,
    },
    {
      shopId: shop.id,
      periodKey: "visual-failure",
      trigger: "manual",
      status: "failed",
      errorCode: "network_unreachable",
      startedAt: new Date(now.getTime() - HOUR_MS),
      finishedAt: new Date(now.getTime() - HOUR_MS),
    },
  ]);
  return NextResponse.json({ ok: true });
}
