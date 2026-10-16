"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setBookkeeper } from "@/db/bookkeeper";
import { canPersonExportShopData } from "@/db/export";
import { bookkeeperAddress } from "@/lib/bookkeeper";
import { nowDate } from "@/lib/clock";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/** What the form says after a save; the words are the component's. */
export type BookkeeperFormState = { status: "idle" | "saved" | "cleared" | "invalid" };

/**
 * **The bookkeeper's address** (fifth loop, item 35; ADR
 * 20261016-bookkeeper-month-end-email). Setting it schedules a month of diver
 * names, crew names and money to leave the shop every month, so it takes the
 * month-end download's own gate: an owner or manager (`canPersonExportShopData`,
 * re-read from live roles) and the export step-up. The shop is the session's;
 * a slug naming another shop ends in `requireShopSurface`. An empty field
 * turns the email off.
 */
export async function saveBookkeeperAction(
  shopSlug: string,
  _previous: BookkeeperFormState,
  formData: FormData,
): Promise<BookkeeperFormState> {
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonExportShopData,
    refusal: { notice: "reports-not-authorized" },
  });
  const reports = shopPath(shop.slug, "reports");
  if (!(await hasRequiredStepUp(db, session, "export"))) {
    redirect(stepUpChallengeUrl(shop.slug, "export", `${reports}#bookkeeper`));
  }
  const raw = String(formData.get("email") ?? "");
  const base = { shopId: shop.id, timeZone: shop.timezone, personId: session.user.personId };
  if (raw.trim() === "") {
    await setBookkeeper(db, { ...base, email: null, now: nowDate() });
    revalidatePath(reports);
    return { status: "cleared" };
  }
  const email = bookkeeperAddress(raw);
  if (!email) return { status: "invalid" };
  await setBookkeeper(db, { ...base, email, now: nowDate() });
  revalidatePath(reports);
  return { status: "saved" };
}
