import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { people, shops } from "./schema";

/** The freshly inserted fictional cast only; never match existing people by name. */
export const DEMO_DIVER_PORTRAITS: Readonly<Record<string, string>> = {
  "Priya Sharma": "/demo-divers/priya-sharma.webp",
  "Tom Okafor": "/demo-divers/tom-okafor.webp",
  "June Park": "/demo-divers/june-park.webp",
  "Nadia Petrov": "/demo-divers/nadia-petrov.webp",
};

export async function seedDiverPortraits(
  db: DbExecutor,
  shopId: string,
  cast: readonly { id: string; fullName: string }[],
): Promise<void> {
  const [shop] = await db.select({ isDemo: shops.isDemo }).from(shops).where(eq(shops.id, shopId));
  if (!shop?.isDemo) return;
  for (const person of cast) {
    const path = DEMO_DIVER_PORTRAITS[person.fullName];
    if (!path) continue;
    await db
      .update(people)
      .set({ staffPhotoPath: path })
      .where(
        and(
          eq(people.shopId, shopId),
          eq(people.id, person.id),
          isNull(people.deletedAt),
          isNull(people.staffPhotoPath),
        ),
      );
  }
}
