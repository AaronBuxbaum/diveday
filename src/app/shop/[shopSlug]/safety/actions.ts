"use server";

import { getDb } from "@/db/client";
import { deleteSafetyDrill, recordSafetyDrill } from "@/db/safety-drills";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * **The drill log's two acts** (loop 5, row 2): log a drill, delete one
 * (softly). Each lands back on the Safety tab with its notice, at the month
 * the staffer was reading. The writer re-checks the Safety tab's gate, the
 * date, the kind and every person named; nothing posted is believed.
 */

/** The month the form was posted from, kept only when it is a month key. */
function safetyPage(slug: string, formData: FormData): string {
  const month = formData.get("month");
  const page = shopPath(slug, "safety");
  return typeof month === "string" && /^\d{4}-\d{2}$/.test(month)
    ? `${page}?month=${month}#drills`
    : `${page}#drills`;
}

export async function recordSafetyDrillAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = safetyPage(session.user.shopSlug, formData);
  const participantIds = formData
    .getAll("participant")
    .flatMap((value) => (typeof value === "string" && uuidParam(value) ? [value] : []));
  const note = formData.get("note");
  const outcome = await recordSafetyDrill(await getDb(), {
    shopId: session.user.shopId,
    recordedByPersonId: session.user.personId,
    kind: String(formData.get("kind") ?? ""),
    heldOn: String(formData.get("heldOn") ?? ""),
    note: typeof note === "string" ? note : null,
    participantIds,
  });
  revalidateAndRedirect(
    shopPath(session.user.shopSlug, "safety"),
    noticeUrl(page, outcome.ok ? "drill-logged" : "drill-invalid"),
  );
}

export async function deleteSafetyDrillAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = safetyPage(session.user.shopSlug, formData);
  const drillId = uuidParam(String(formData.get("drillId") ?? ""));
  const deleted = drillId
    ? await deleteSafetyDrill(await getDb(), {
        shopId: session.user.shopId,
        personId: session.user.personId,
        drillId,
      })
    : false;
  revalidateAndRedirect(
    shopPath(session.user.shopSlug, "safety"),
    noticeUrl(page, deleted ? "drill-deleted" : "drill-invalid"),
  );
}
