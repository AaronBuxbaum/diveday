"use server";

import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { planDiveSitePhotoRelease } from "@/db/dive-site-photos";
import {
  deleteDiveSite,
  getDiveSite,
  pullDiveSiteTemplateUpdates,
  SITE_EDIT_CONFLICT,
  SITE_NAME_TAKEN,
  undoDiveSiteTemplateUpdate,
  updateDiveSiteForForm,
} from "@/db/dive-sites";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { diveSpecialty } from "@/db/schema";
import { getShopById } from "@/db/shops";
import type { DiveSiteTemplateUpdateMode } from "@/lib/dive-site-template-sync";
import { type DiveSiteFormError, parseDiveSiteForm, submittedValues } from "@/lib/dive-sites";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { supersededDiveSitePhotos, uploadDiveSitePhotos } from "@/lib/storage/dive-site-photos";
import { uuidParam } from "@/lib/uuid";
import type { SiteFormState } from "../_components/SiteFormShell";
import { siteFormExtras, templatePullMode } from "../site-forms";

/**
 * The edit page's four doors: save the briefing, delete the site, and pull or undo an update
 * from the DiveDay template it was copied from. They lived inline in `page.tsx` as closures over
 * the page's `id`; the page now binds the site id, and each action re-validates it and scopes
 * every read and write to the session's own shop, so a tampered id can only name another of
 * the staffer's own sites.
 */

const specialtySchema = z.enum(diveSpecialty.enumValues);

export async function saveDiveSiteAction(
  siteId: string,
  _state: SiteFormState,
  formData: FormData,
): Promise<SiteFormState> {
  const activeSession = await requireStaffSession();
  const id = uuidParam(siteId);
  if (!id) notFound();
  const back = shopPath(activeSession.user.shopSlug, "dive-sites");
  // Every refusal carries the whole submission back to the form, so an edit
  // in progress survives a rejected save (see `SiteFormShell`).
  const refuse = (errorCode: DiveSiteFormError): SiteFormState => ({
    errorCode,
    values: submittedValues(formData),
  });
  // Depth arrives in whatever unit this shop works in; metres is what's
  // stored. Re-read the shop rather than trusting a form field for the unit —
  // a hidden input would let a crafted post store a depth 3.3x off.
  const activeShop = await getShopById(await getDb(), activeSession.user.shopId);
  const parsed = parseDiveSiteForm(Object.fromEntries(formData), activeShop?.depthUnit ?? "meters");
  if (!parsed.ok) return refuse(parsed.error);
  const specialties = z.array(specialtySchema).safeParse(formData.getAll("specialty").map(String));
  if (!specialties.success) return refuse("invalid");
  // The site as stored, re-read rather than closed over: this action runs
  // long after the page rendered, and it decides what a blank file input
  // means (keep what is there) and which objects this save orphans.
  const activeDb = await getDb();
  const stored = await getDiveSite(activeDb, activeSession.user.shopId, id);
  if (!stored) notFound();
  // The generation this page was rendered from, as the staffer's tab last saw
  // it. A non-numeric value is treated as absent rather than thrown: this page
  // is the only thing that writes the field, so a bad one means an old release
  // or a hand-crafted post, and neither is worth a 500 over an input that can
  // only ever tighten the write.
  const extras = siteFormExtras(formData);
  if (!extras) return refuse("invalid");
  // **Checked before a single byte is uploaded.** `dive-site-photos.ts` says
  // why in its own words — refusing after storing four photos leaves objects
  // nothing references, and a refusal never gets far enough to persist their
  // URLs, so they are invisible to the unfinished-deletions panel too. The
  // authoritative check is still the one in the `where` below, which is
  // atomic with the write; this only stops the wasted upload.
  if (extras.expectedVersion !== null && stored.rowVersion !== extras.expectedVersion) {
    return refuse("conflict");
  }
  // Uploaded from the staffer's own device straight into first-party
  // storage — there is no pasted URL for a public page to fetch (CR-020).
  const photos = await uploadDiveSitePhotos(formData, stored);
  if (!photos.ok) {
    return refuse(photos.reason === "not_configured" ? "imagesUnconfigured" : "images");
  }
  // `maxDepth` and `expectedBottomTime` are the form's own fields, not
  // columns — they became `parsed.maxDepthMeters` /
  // `parsed.expectedBottomTimeMinutes`, so neither may reach the spread.
  const {
    maxDepth: _maxDepth,
    expectedBottomTime: _expectedBottomTime,
    // The note and its author are one value on the row, so the form's plain
    // string is rebuilt into it below rather than carried by the spread.
    planningNote: planningNoteWords,
    ...siteFields
  } = parsed.fields;
  // Issue #2078: which superseded photos are this shop's, asked before the write.
  const releasable = await planDiveSitePhotoRelease(
    activeDb,
    activeSession.user.shopId,
    id,
    supersededDiveSitePhotos(stored, photos.photos),
  );
  const updated = await updateDiveSiteForForm(
    activeDb,
    activeSession.user.shopId,
    id,
    {
      shopId: activeSession.user.shopId,
      ...siteFields,
      forecastLatitude:
        parsed.fields.forecastLatitude === "" ? null : parsed.fields.forecastLatitude,
      forecastLongitude:
        parsed.fields.forecastLongitude === "" ? null : parsed.fields.forecastLongitude,
      satelliteImageUrl: photos.photos.satelliteImageUrl,
      routeImageUrl: photos.photos.routeImageUrl,
      imageUrls: photos.photos.imageUrls,
      planningNote: {
        words: planningNoteWords,
        byPersonId: activeSession.user.personId,
      },
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
      creatures: parsed.creatures,
      routePoints: parsed.route.points,
      routeLabel: parsed.route.label,
      routeNote: parsed.route.note,
      routeZoom: parsed.route.zoom,
    },
    { expectedVersion: extras.expectedVersion },
  );
  // Somebody else saved the briefing between this page rendering and this
  // post. Refused rather than merged, and `refuse` hands back everything that
  // was typed, so the message announcing that nothing was lost is not itself
  // what loses it (issue #820).
  if (updated === SITE_EDIT_CONFLICT) return refuse("conflict");
  // The name is the one rule the parse above could not check — it takes the
  // whole shop's library to know — so the database refuses it and the
  // briefing comes back to the form like any other refusal.
  if (updated === SITE_NAME_TAKEN) return refuse("nameTaken");
  if (!updated) notFound();
  // Only once the row is durably saved: a photo this save replaced or
  // removed is queued for provider deletion, never blocked on storage and
  // owner-visible if it fails (CR-012), and only once no other site shows it.
  for (const url of await releasable()) {
    await queueAndAttemptMediaDeletion(activeDb, {
      shopId: activeSession.user.shopId,
      kind: "dive_site_photo",
      url,
    });
  }
  revalidateAndRedirect(`${back}/${id}`, noticeUrl(`${back}/${id}`, "saved"));
}

export async function deleteDiveSiteAction(siteId: string) {
  const activeSession = await requireStaffSession();
  const id = uuidParam(siteId);
  if (!id) notFound();
  const back = shopPath(activeSession.user.shopSlug, "dive-sites");
  const deleted = await deleteDiveSite(await getDb(), activeSession.user.shopId, id);
  revalidateAndRedirect(back, deleted ? noticeUrl(back, "deleted") : `${back}/${id}?error=invalid`);
}

export async function pullDiveSiteTemplateAction(siteId: string, formData: FormData) {
  const activeSession = await requireStaffSession();
  const id = uuidParam(siteId);
  if (!id) notFound();
  const back = shopPath(activeSession.user.shopSlug, "dive-sites");
  const mode = templatePullMode(formData);
  if (mode !== "preserve-shop-edits" && mode !== "replace-template-copy") {
    revalidateAndRedirect(
      `${back}/${id}`,
      noticeUrl(`${back}/${id}`, "template-update-unavailable"),
    );
  }
  const result = await pullDiveSiteTemplateUpdates(
    await getDb(),
    activeSession.user.shopId,
    id,
    mode as DiveSiteTemplateUpdateMode,
  );
  revalidateAndRedirect(
    `${back}/${id}`,
    noticeUrl(
      `${back}/${id}`,
      result.status === "updated"
        ? result.mode === "replace-template-copy"
          ? "template-replaced"
          : "template-updated"
        : "template-update-unavailable",
      result.status === "updated" ? { undo: "true" } : undefined,
    ),
  );
}

export async function undoDiveSiteTemplateAction(siteId: string) {
  const activeSession = await requireStaffSession();
  const id = uuidParam(siteId);
  if (!id) notFound();
  const back = shopPath(activeSession.user.shopSlug, "dive-sites");
  const result = await undoDiveSiteTemplateUpdate(await getDb(), activeSession.user.shopId, id);
  revalidateAndRedirect(
    `${back}/${id}`,
    noticeUrl(
      `${back}/${id}`,
      result.status === "undone" ? "template-undone" : "template-update-unavailable",
    ),
  );
}
