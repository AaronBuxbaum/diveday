"use server";

import { z } from "zod";
import { canPersonManageShopSettings } from "@/db/authz";
import { acceptSetupLine, dismissSetupLine, readWebsiteForSetup } from "@/db/website-setup";
import { readForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const siteForm = z.object({ site: z.string().max(500).default("") });
const lineForm = z.object({ key: z.string().max(64).default("") });

/**
 * **Set up from the website** (ADR 20261018-claude-assists; the `setup`
 * assist). Reading a site stores proposals and writes nothing to the shop;
 * each accepted line is one narrow write, the owner's own tap. Gated like the
 * settings these lines land in, and re-checked on every post. The shop is the
 * session's, whatever slug the form carried.
 */
async function setupContext(shopSlug: string) {
  const surface = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const tab = `${shopPath(shopSlug, "settings", "import")}?what=website`;
  return { ...surface, tab };
}

export async function readWebsiteSetupAction(shopSlug: string, formData: FormData): Promise<void> {
  const { db, shop, tab } = await setupContext(shopSlug);
  const outcome = await readWebsiteForSetup(db, {
    shopId: shop.id,
    site: readForm(siteForm, formData).site,
  });
  revalidateAndRedirect(tab, noticeUrl(tab, `setup-${outcome}`));
}

export async function acceptSetupLineAction(shopSlug: string, formData: FormData): Promise<void> {
  const { db, shop, session, tab } = await setupContext(shopSlug);
  const outcome = await acceptSetupLine(db, {
    shopId: shop.id,
    personId: session.user.personId,
    key: readForm(lineForm, formData).key,
  });
  if (outcome === "departure-drafted") {
    // The board's own Add a departure, opened on the draft this line became.
    const board = shopPath(shopSlug, "schedule", "board");
    revalidateAndRedirect(board, `${board}?add=1`);
  }
  revalidateAndRedirect(tab, noticeUrl(tab, outcome === "saved" ? "setup-saved" : "setup-gone"));
}

export async function dismissSetupLineAction(shopSlug: string, formData: FormData): Promise<void> {
  const { db, shop, tab } = await setupContext(shopSlug);
  const dismissed = await dismissSetupLine(db, shop.id, readForm(lineForm, formData).key);
  revalidateAndRedirect(tab, dismissed ? tab : noticeUrl(tab, "setup-gone"));
}
