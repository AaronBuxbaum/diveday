"use server";

import { notFound, redirect } from "next/navigation";
import { canPersonManageShopSettings } from "@/db/authz";
import { recordPrintRun } from "@/db/print-runs";
import { isPrintSheetCode, type PrintRunSheetCode, printSheetPath } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * **Printing a sheet is an act, so it goes through an action** — ADR
 * 20260908-one-hand, decision 6, lever X.
 *
 * Each door in the register is a form rather than a link, for one reason: the
 * register's whole job is to say how old the paper taped to the console is, and
 * a link cannot record that a shop printed something. The action records the
 * run and then hands the reader the sheet, which opens its own print dialog.
 *
 * The write is deliberately *before* the redirect and not inside a `try`: a
 * `redirect` throws its own sentinel, and catching it is how a refusal ends up
 * reporting success (`scripts/check-redirect-in-try.mjs`).
 */

/** The registry's doors, which live inside Settings and take its gate. */
export async function printSheetAction(formData: FormData): Promise<void> {
  const shopSlug = String(formData.get("shopSlug") ?? "");
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });

  const sheet = formData.get("sheet");
  // Narrowed against the registry, never trusted: the value decides both which
  // row is dated and which route the reader is sent to.
  if (!isPrintSheetCode(sheet) || sheet === "year_poster" || sheet === "paper_pass") notFound();
  const rawSubject = formData.get("subjectId");
  const subjectId = rawSubject == null ? null : uuidParam(String(rawSubject));
  const destination = printSheetPath(shop.slug, sheet, subjectId);
  if (!destination) notFound();

  await recordPrintRun(db, shop.id, sheet as PrintRunSheetCode, subjectId);
  redirect(destination);
}

/**
 * The counter's door: a pass for the diver standing at the desk.
 *
 * **Ungated beyond the staff session**, like the rental slip it sits beside
 * (H-06, amended on H-14's row): handing a diver their boat and their time is
 * day work, and the counter is where the crew who do it stand. The register's
 * own rows keep Settings' gate; this one cannot, or the person at the desk
 * could not print it.
 */
export async function printPassAction(formData: FormData): Promise<void> {
  const shopSlug = String(formData.get("shopSlug") ?? "");
  const { db, shop } = await requireShopSurface(shopSlug);
  const bookingId = uuidParam(String(formData.get("bookingId") ?? ""));
  if (!bookingId) notFound();
  const destination = printSheetPath(shop.slug, "paper_pass", bookingId);
  if (!destination) notFound();

  // The register keeps *when* a pass was last printed and never *whose*: the
  // subject is left empty on purpose (`shop_print_runs`).
  await recordPrintRun(db, shop.id, "paper_pass");
  redirect(destination);
}
