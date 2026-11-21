import { randomUUID } from "node:crypto";
import type { AppDb } from "@/db/client";
import { demoPreviews } from "@/db/schema";

export async function demoPreviewRetentionFixture({ db }: { db: AppDb }, at: Date) {
  const [row] = await db
    .insert(demoPreviews)
    .values({
      demoShopId: randomUUID(),
      shopSlug: "reef-line-divers",
      prospectName: "Reef Line Divers",
      createdAt: at,
      expiresAt: at,
    })
    .returning({ id: demoPreviews.id });
  if (!row) throw new Error("Demo preview fixture insert returned nothing");
  return row.id;
}
