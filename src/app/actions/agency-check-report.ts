"use server";

import { z } from "zod";
import { AGENCY_CHECKS } from "@/lib/agency-check";
import { formValue, readForm } from "@/lib/form-parse";
import { log } from "@/lib/log";
import { agencyCheckReportContext, PAGE_SHAPE_LOG_EVENT } from "@/lib/page-shape";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { requireStaffSession } from "@/lib/session";

/**
 * Why a check the extension could not finish ended, for DiveDay's log: the
 * agency, a fixed reason, the extension's version, and the page's shape in
 * form words only (`src/lib/page-shape.ts`). One line per failed check
 * (`agency_check.page_shape`), so the runbook can count an agency's failures
 * and read what its page looked like. A signed-out PADI check sends nothing:
 * that is the staffer's sign-in, not the page.
 *
 * Nothing is written to the database and nothing comes back. The shop comes
 * off the session; the post is refused by its contents, not answered, and
 * past a staffer's or a shop's hour's allowance it is dropped unread
 * (`RATE_LIMITS.agencyCheckReportByPerson`, `agencyCheckReportByShop`).
 */
const agencyCheckReportForm = z.object({
  agency: formValue(),
  reason: formValue(),
  version: formValue(),
  pageShape: formValue(),
});

export async function reportAgencyCheckPageAction(formData: FormData): Promise<void> {
  const session = await requireStaffSession();
  const byPerson = await checkRateLimit(
    rateLimitKey("agency-check-report", "person", session.user.personId),
    RATE_LIMITS.agencyCheckReportByPerson,
  );
  if (!byPerson.allowed) return;
  const byShop = await checkRateLimit(
    rateLimitKey("agency-check-report", "shop", session.user.shopId),
    RATE_LIMITS.agencyCheckReportByShop,
  );
  if (!byShop.allowed) return;
  const form = readForm(agencyCheckReportForm, formData);
  const context = agencyCheckReportContext(
    { ...form, pageShape: form.pageShape ?? "" },
    {
      agencies: Object.keys(AGENCY_CHECKS),
      reasons: ["fill_failed", "timeout", "tab_failed", "captcha", "page_changed", "unsupported"],
    },
  );
  if (!context) return;
  log(PAGE_SHAPE_LOG_EVENT, "warn", { shopId: session.user.shopId, ...context });
}
