import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { people } from "@/db/schema";
import { privatePersonPhotoId } from "@/lib/person-photo";

/** Only the current private asset on a live person in this shop may be read. */
export async function currentPrivatePersonPhoto(
  db: DbExecutor,
  shopId: string,
  personId: string,
  assetId: string,
): Promise<string | null> {
  const [person] = await db
    .select({ path: people.diverPhotoPath })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        eq(people.id, personId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
        eq(people.diverPhotoSuppressed, false),
      ),
    )
    .limit(1);
  return person?.path && privatePersonPhotoId(person.path) === assetId ? person.path : null;
}
