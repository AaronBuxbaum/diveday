"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import { getDb } from "@/db/client";
import { saveWaiverTemplate } from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { DEFAULT_WAIVER_TITLE } from "@/lib/waivers";

const templateSchema = z.object({
  body: z.string().trim().min(40).max(12_000),
});

/**
 * Publish a new version of the shop's waiver — its legal instrument, and the
 * text every diver signs from here on.
 *
 * The page's own module rather than an inline `"use server"` closure (AGENTS.md
 * layout rule for a large page) so the gate below can be exercised on its own:
 * an inline closure is only reachable through the page that renders it, which is
 * exactly the layer a POST straight at the action skips. The gate stays *inside*
 * the action for that reason — the page's own check guards the render, this one
 * guards the write (ADR-0006). See `./actions.authz.test.ts`.
 */
export async function saveWaiverAction(formData: FormData) {
  const staff = await requireStaffSession();
  const editor = await getDb();
  if (!(await canPersonManageWaiverTemplates(editor, staff.user.shopId, staff.user.personId))) {
    redirect(noticeUrl(shopPath(staff.user.shopSlug), "waivers-not-authorized"));
  }
  const waivers = shopPath(staff.user.shopSlug, "waivers");
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(waivers, "invalid"));
  await saveWaiverTemplate(editor, {
    shopId: staff.user.shopId,
    title: DEFAULT_WAIVER_TITLE,
    body: parsed.data.body,
  });
  revalidateAndRedirect(waivers, noticeUrl(waivers, "saved"));
}
