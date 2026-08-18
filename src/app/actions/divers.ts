"use server";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { createDiver } from "@/db/divers";
import { people } from "@/db/schema";
import { revalidateAndRedirect } from "@/lib/navigation";
import { diverSearchPrefill } from "@/lib/person-fields";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/** Create the person behind a staff search and land directly on their record. */
export async function createDiverFromSearchAction(formData: FormData) {
  const staff = await requireStaffSession();
  const db = await getDb();
  const roster = shopPath(staff.user.shopSlug, "divers");
  const query = String(formData.get("query") ?? "").trim();
  const prefill = diverSearchPrefill(query);
  if (!query || Object.keys(prefill).length === 0) {
    revalidateAndRedirect(roster, noticeUrl(roster, "invalid"));
  }

  const person = await createDiver(db, {
    shopId: staff.user.shopId,
    fullName: prefill.name,
    email: prefill.email,
    phone: prefill.phone,
  });
  let personId = person?.id;

  // Choosing "Add diver" for an email that appeared in the search results is
  // still safe: the email is the identity key, so take the staffer to the
  // existing record instead of making a duplicate.
  if (!person && prefill.email) {
    const [existing] = await db
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.shopId, staff.user.shopId),
          eq(people.email, prefill.email.toLowerCase()),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);
    personId = existing?.id;
  }

  if (!personId) revalidateAndRedirect(roster, noticeUrl(roster, "invalid"));
  revalidateAndRedirect(roster, `${shopPath(staff.user.shopSlug, "divers", personId)}?edit=1`);
}
