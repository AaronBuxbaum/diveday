"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formValue, readForm, text } from "@/features/form-parse";
import { revalidateAndRedirect } from "@/features/navigation";
import { requireShopSurface } from "@/features/session";
import { setCrewPublicConsent } from "@/features/staff-accounts";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const crewPublicForm = z.object({
  personId: text(),
  consented: formValue().transform(Boolean),
  publicName: formValue().transform((value) => value?.toString() ?? null),
});
export async function saveCrewPublicConsentAction(shopSlug: string, formData: FormData) {
  const { session, db } = await requireShopSurface(shopSlug);
  const path = shopPath(shopSlug, "me", "security");
  const crewPublic = readForm(crewPublicForm, formData);
  const personId = crewPublic.personId;
  // Not a refusal notice: a request naming somebody else is not a mistake a
  // form can make, so it gets no explanation and no trace of whether that
  // person exists.
  if (!personId || personId !== session.user.personId) redirect(noticeUrl(path, "invalid"));

  const consented = crewPublic.consented;
  // Passed through raw: trimming, collapsing, capping and the fall back to the
  // shop's own record all live in `crewPublicNameToStore`, beside the write, so
  // the register's rules cannot drift from this one form's reading of them.
  const saved = await setCrewPublicConsent(db, {
    shopId: session.user.shopId,
    personId,
    actorPersonId: session.user.personId,
    consented,
    publicName: crewPublic.publicName,
  });
  // Two codes rather than one, because the words are directional: a single
  // "Divers will see your first name" told somebody who had just unticked the
  // box the opposite of what had happened, in a success-toned banner. On any
  // other form that is a copy nit; on the withdrawal of a consent it is the one
  // sentence the person reads to decide whether they need to go and find their
  // owner.
  const code = saved
    ? consented
      ? "crew-consent-saved"
      : "crew-consent-withdrawn"
    : "staff-not-found";
  revalidateAndRedirect(path, noticeUrl(path, code));
}
