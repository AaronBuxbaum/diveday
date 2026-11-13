"use server";

import { getDb } from "@/db/client";
import { revalidateAndRedirect } from "@/features/navigation";
import { deleteSafetyDrill, recordSafetyDrill } from "@/features/safety-drills";
import { requireStaffSession } from "@/features/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * **The drill log's two acts** (loop 5, row 2): log a drill, delete one
 * (softly). Each lands back on the Drills tab with its notice. The writer re-checks the Safety tab's gate, the
 * date, the kind and every person named; nothing posted is believed.
 */

/** Both acts land on the Drills tab, where the form and the log are. */
function drillsPage(slug: string): string {
  return `${shopPath(slug, "safety", "drills")}#drills`;
}

export async function recordSafetyDrillAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = drillsPage(session.user.shopSlug);
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
    shopPath(session.user.shopSlug, "safety", "drills"),
    noticeUrl(page, outcome.ok ? "drill-logged" : "drill-invalid"),
  );
}

export async function deleteSafetyDrillAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = drillsPage(session.user.shopSlug);
  const drillId = uuidParam(String(formData.get("drillId") ?? ""));
  const deleted = drillId
    ? await deleteSafetyDrill(await getDb(), {
        shopId: session.user.shopId,
        personId: session.user.personId,
        drillId,
      })
    : false;
  revalidateAndRedirect(
    shopPath(session.user.shopSlug, "safety", "drills"),
    noticeUrl(page, deleted ? "drill-deleted" : "drill-invalid"),
  );
}
