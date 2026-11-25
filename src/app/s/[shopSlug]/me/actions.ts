"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { recordDiverOwnContact } from "@/features/accounts/diver-profile";
import { currentDiver } from "@/features/accounts/diver-sign-in";
import { publicProfilePath, publicSignInPath } from "@/lib/public-routes";

const contactForm = z.object({
  phone: z.string().trim().max(40),
  emergencyContactName: z.string().trim().max(120),
  emergencyContactPhone: z.string().trim().max(40),
});

/** The signed-in diver corrects their phone and emergency contact; the session names whose. */
export async function saveDiverContactAction(shopSlug: string, formData: FormData) {
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const diver = shop ? await currentDiver(db, shop.id) : null;
  if (!shop || !diver) redirect(publicSignInPath(shopSlug));
  const parsed = contactForm.safeParse({
    phone: formData.get("phone") ?? "",
    emergencyContactName: formData.get("emergencyContactName") ?? "",
    emergencyContactPhone: formData.get("emergencyContactPhone") ?? "",
  });
  if (!parsed.success) redirect(`${publicProfilePath(shopSlug)}?error=pair#details`);
  const outcome = await recordDiverOwnContact(db, {
    shopId: shop.id,
    personId: diver.personId,
    ...parsed.data,
  });
  redirect(
    `${publicProfilePath(shopSlug)}?${outcome === "saved" ? "saved=1" : "error=pair"}#details`,
  );
}
