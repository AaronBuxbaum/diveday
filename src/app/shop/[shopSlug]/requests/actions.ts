"use server";

import { z } from "zod";
import { setDateInterestOutcome } from "@/db/interests";
import { nowDate } from "@/lib/clock";
import { parseForm, single } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

const outcomeForm = z.object({
  requestId: single(z.uuid()),
  // "open" is Reopen; a booking stamps `booked` from the seat itself, never here.
  outcome: single(z.enum(["done", "open"])),
});

/**
 * **Close a request, or reopen it** (third UX review, item 13). Every live
 * staff role reads the Requests page (issue #1679), so every one may tick a
 * lead it has answered. The id is scoped to the session's shop in the writer.
 */
export async function setRequestOutcomeAction(shopSlug: string, formData: FormData) {
  const { shop, db } = await requireShopSurface(shopSlug);
  const back = shopPath(shopSlug, "requests");
  const parsed = parseForm(outcomeForm, formData);
  if (parsed.ok) {
    await setDateInterestOutcome(db, {
      shopId: shop.id,
      interestId: parsed.data.requestId,
      outcome: parsed.data.outcome === "done" ? "done" : null,
      now: nowDate(),
    });
  }
  revalidateAndRedirect(back);
}
