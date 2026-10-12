"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { createDiveSiteForForm, SITE_NAME_TAKEN } from "@/db/dive-sites";
import { diveSpecialty } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { type DiveSiteFormError, parseDiveSiteForm, submittedValues } from "@/lib/dive-sites";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uploadDiveSitePhotos } from "@/lib/storage/dive-site-photos";
import type { SiteFormState } from "../_components/SiteFormShell";
import { siteFormExtras } from "../site-forms";

const specialtySchema = z.enum(diveSpecialty.enumValues);

/**
 * Create a dive site from the new-site form, in the session's own shop, and open
 * it. A refusal does not navigate: it answers into the form with the whole
 * submission, so a staffer fixes the one field that was wrong (`SiteFormShell`).
 * It was an inline closure in `page.tsx` until the 2026-10-11 review moved it
 * here to be testable; the shop and the way back come from the session, never
 * from the page's URL.
 */
export async function createDiveSiteAction(
  _state: SiteFormState,
  formData: FormData,
): Promise<SiteFormState> {
  const activeSession = await requireStaffSession();
  const back = shopPath(activeSession.user.shopSlug, "dive-sites");
  // Every refusal carries the whole submission back to the form, which is
  // what lets a staffer fix the one field that was wrong instead of retyping
  // a briefing (see `SiteFormShell`).
  const refuse = (errorCode: DiveSiteFormError): SiteFormState => ({
    errorCode,
    values: submittedValues(formData),
  });
  // Depth arrives in whatever unit this shop works in; metres is what's
  // stored. Re-read the shop rather than trusting a form field for the unit —
  // a hidden input would let a crafted post store a depth 3.3× off.
  const activeShop = await getShopById(await getDb(), activeSession.user.shopId);
  const parsed = parseDiveSiteForm(Object.fromEntries(formData), activeShop?.depthUnit ?? "meters");
  if (!parsed.ok) return refuse(parsed.error);
  const specialties = z.array(specialtySchema).safeParse(formData.getAll("specialty").map(String));
  const extras = siteFormExtras(formData);
  if (!specialties.success || !extras) return refuse("invalid");
  // Uploaded from the staffer's own device straight into first-party
  // storage — there is no pasted URL for a public page to fetch (CR-020).
  const photos = await uploadDiveSitePhotos(formData);
  if (!photos.ok) {
    return refuse(photos.reason === "not_configured" ? "imagesUnconfigured" : "images");
  }
  // `maxDepth` and `expectedBottomTime` are the form's own fields, not
  // columns — they became `parsed.maxDepthMeters` /
  // `parsed.expectedBottomTimeMinutes`, so neither may reach the spread.
  const {
    maxDepth: _maxDepth,
    expectedBottomTime: _expectedBottomTime,
    // The note and its author are one value on the row (issue #1204).
    planningNote: planningNoteWords,
    ...siteFields
  } = parsed.fields;
  const site = await createDiveSiteForForm(await getDb(), {
    shopId: activeSession.user.shopId,
    ...siteFields,
    forecastLatitude: parsed.fields.forecastLatitude === "" ? null : parsed.fields.forecastLatitude,
    forecastLongitude:
      parsed.fields.forecastLongitude === "" ? null : parsed.fields.forecastLongitude,
    satelliteImageUrl: photos.photos.satelliteImageUrl,
    routeImageUrl: photos.photos.routeImageUrl,
    imageUrls: photos.photos.imageUrls,
    planningNote: { words: planningNoteWords, byPersonId: activeSession.user.personId },
    minimumCertificationLevel: parsed.fields.minimumCertificationLevel,
    requiredSpecialties: specialties.data,
    requiresNitrox: extras.requiresNitrox,
    difficultyLevel: parsed.difficultyLevel,
    depthRange: parsed.fields.depthRange,
    maxDepthMeters: parsed.maxDepthMeters,
    expectedBottomTimeMinutes: parsed.expectedBottomTimeMinutes,
    currentNote: parsed.fields.currentNote,
    divePlan: parsed.fields.divePlan,
    conservationNote: parsed.fields.conservationNote,
    fitTone: parsed.fields.fitTone,
    fitNote: parsed.fields.fitNote,
    fieldGuideTipsHeading: parsed.fields.fieldGuideTipsHeading,
    landmarks: photos.photos.landmarks,
    // The field guide is written on this same form now, so a brand-new site
    // can arrive with one — every species the staffer picked from the
    // catalog, in the order they put them.
    creatures: parsed.creatures,
    routePoints: parsed.route.points,
    routeLabel: parsed.route.label,
    routeNote: parsed.route.note,
    routeZoom: parsed.route.zoom,
  });
  // The name is the one rule the parse above could not check — it takes the
  // whole shop's library to know, and an archived site still holds its name —
  // so the database refuses it and the briefing comes back to the form.
  if (site === SITE_NAME_TAKEN) return refuse("nameTaken");
  revalidateAndRedirect(back, `${back}/${site.id}`);
}
