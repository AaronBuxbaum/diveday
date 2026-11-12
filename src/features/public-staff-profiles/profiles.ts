import { and, eq, inArray, isNull } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import type { AppDb } from "@/db/client";
import { queueMediaDeletion, retryMediaDeletion } from "@/db/media-deletions";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { STAFF_ROLES } from "@/lib/authz";
import { type PublicStaffProfile, publicStaffProfileSchema } from "@/lib/public-staff-profile";

/** Only explicit profile consent, never crew-name consent, publishes these words. */
export async function listPublicStaffProfiles(
  db: AppDb,
  shopId: string,
  personIds?: readonly string[],
): Promise<PublicStaffProfile[]> {
  if (personIds?.length === 0) return [];
  const rows = await db
    .selectDistinct({ personId: people.id, profile: people.publicStaffProfile })
    .from(people)
    .innerJoin(shops, eq(shops.id, people.shopId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        eq(people.publicStaffProfileEnabled, true),
        eq(shops.publicStaffProfilesEnabled, true),
        eq(userAccounts.status, "active"),
        inArray(personRoles.role, [...STAFF_ROLES]),
        personIds ? inArray(people.id, [...personIds]) : undefined,
      ),
    );
  return rows
    .flatMap(({ profile }) => (profile ? [profile] : []))
    .sort((a, b) => a.firstName.localeCompare(b.firstName));
}

/** The editor reads only the authenticated person's own live record. */
export async function ownStaffProfile(db: AppDb, shopId: string, personId: string) {
  const [row] = await db
    .select({ profile: people.publicStaffProfile, enabled: people.publicStaffProfileEnabled })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        eq(people.id, personId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    );
  return row ?? null;
}

/** Store only a self-authored profile. The action owns uploaded URLs; clients cannot attach them. */
export async function writeOwnStaffProfile(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    actorPersonId: string;
    enabled: boolean;
    profile: PublicStaffProfile | null;
    expected?: PublicStaffProfile | null;
  },
): Promise<boolean> {
  if (input.personId !== input.actorPersonId) return false;
  const parsed = input.profile === null ? null : publicStaffProfileSchema.safeParse(input.profile);
  if ((parsed && !parsed.success) || (input.enabled && !parsed)) return false;
  const retired: string[] = [];
  const committed = await db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, input.shopId, "rewrite");
    const [row] = await tx
      .select({ profile: people.publicStaffProfile })
      .from(people)
      .where(
        and(
          eq(people.shopId, input.shopId),
          eq(people.id, input.personId),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      // diveday:allow-update-lock: serialize edits and media retirement on the profile's own row.
      .for("update");
    if (
      !row ||
      (input.expected !== undefined &&
        JSON.stringify(row.profile) !== JSON.stringify(input.expected))
    )
      return false;
    const profile = parsed?.success ? parsed.data : null;
    await tx
      .update(people)
      .set({ publicStaffProfileEnabled: input.enabled, publicStaffProfile: profile })
      .where(and(eq(people.shopId, input.shopId), eq(people.id, input.personId)));
    for (const url of row.profile?.photoUrls ?? []) {
      if (!profile?.photoUrls.includes(url)) {
        const deletion = await queueMediaDeletion(tx, {
          shopId: input.shopId,
          personId: input.personId,
          kind: "staff_profile",
          url,
        });
        if (deletion) retired.push(deletion.id);
      }
    }
    return true;
  });
  // A provider or retry failure leaves the committed ledger obligation for recovery.
  // It must never turn a successful save into cleanup of newly attached pictures.
  if (committed)
    await Promise.allSettled(retired.map((id) => retryMediaDeletion(db, input.shopId, id)));
  return committed;
}
