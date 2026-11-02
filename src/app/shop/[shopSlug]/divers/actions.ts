"use server";

import { z } from "zod";
import { canPersonDeleteDiver } from "@/db/authz";
import { getDb } from "@/db/client";
import { restoreDiver } from "@/db/divers";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const restoreForm = z.object({ personId: z.string().default("") });

/**
 * Undo on the roster's removal toast: bring the diver back. The person
 * is a form field, so `restoreDiver` scopes it to the session's own shop; an
 * active diver who has since claimed the same email refuses it with words.
 */
export async function restoreDiverAction(formData: FormData) {
  const staff = await requireStaffSession();
  const activeDb = await getDb();
  // Restoring is the inverse of the owner/manager-only deletion, so it takes
  // the same gate (H-20260724-staff-role-reach, ADR 20260724-role-authorization).
  const roster = shopPath(staff.user.shopSlug, "divers");
  if (!(await canPersonDeleteDiver(activeDb, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(roster, noticeUrl(roster, "not-authorized"));
  }
  const parsed = parseForm(restoreForm, formData);
  const personId = parsed.ok ? parsed.data.personId : "";
  const restored = personId && (await restoreDiver(activeDb, staff.user.shopId, personId));
  revalidateAndRedirect(roster, noticeUrl(roster, restored ? "restored" : "restore-refused"));
}
