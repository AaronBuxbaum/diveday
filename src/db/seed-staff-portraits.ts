import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { people, shops } from "./schema";

/** Stable cast keys, not names inferred at a production read boundary. */
export const DEMO_STAFF_PORTRAIT_PATHS = {
  dana: "/demo-staff/dana-reyes.webp",
  marcus: "/demo-staff/marcus-webb.webp",
  keiko: "/demo-staff/keiko-tanaka.webp",
  talia: "/demo-staff/talia-okonkwo.webp",
  yusra: "/demo-staff/yusra-idrissi.webp",
  sal: "/demo-staff/sal-moretti.webp",
} as const;

export async function seedStaffPortraits(
  db: DbExecutor,
  shopId: string,
  cast: readonly { id: string; local: keyof typeof DEMO_STAFF_PORTRAIT_PATHS }[],
): Promise<void> {
  const [shop] = await db.select({ isDemo: shops.isDemo }).from(shops).where(eq(shops.id, shopId));
  if (!shop?.isDemo) return;
  for (const person of cast) {
    await db
      .update(people)
      .set({ staffPhotoPath: DEMO_STAFF_PORTRAIT_PATHS[person.local] })
      .where(and(eq(people.shopId, shopId), eq(people.id, person.id), isNull(people.deletedAt)));
  }
}
