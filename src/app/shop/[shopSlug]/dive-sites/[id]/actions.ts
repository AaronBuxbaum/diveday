"use server";

import { notFound } from "next/navigation";
import { canPersonEditDiveSiteAdmission } from "@/db/authz";
import { getDb } from "@/db/client";
import { planDiveSitePhotoRelease } from "@/db/dive-site-photos";
import {
  deleteDiveSite,
  editDiveSiteForForm,
  getDiveSite,
  pullDiveSiteTemplateUpdates,
  SITE_EDIT_CONFLICT,
  SITE_NAME_TAKEN,
  undoDiveSiteTemplateUpdate,
} from "@/db/dive-sites";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import { recordDiveSiteClosure } from "@/features/dive-site-closures";
import {
  changedAdmissionFields,
  type DiveSiteAdmission,
  parseDiveSiteForm,
  submittedValues,
} from "@/features/dive-sites";
import { revalidateAndRedirect } from "@/features/navigation";
import { readRequiredSpecialties } from "@/features/requirement-form";
import { requireStaffSession } from "@/features/session";
import { supersededDiveSitePhotos, uploadDiveSitePhotos } from "@/features/storage";
import type { DiveSiteTemplateUpdateMode } from "@/lib/dive-site-template-sync";
import { parseServiceWindow } from "@/lib/service-window";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import type { SiteFormState, SiteSaveRefusal } from "../_components/SiteFormShell";
import { siteFormExtras, templatePullMode } from "../site-forms";
import { planSpanishBoxes, writeSpanishBoxes } from "../spanish-boxes";

/**
 * The edit page's four doors: save the briefing, delete the site, and pull or undo an update
 * from the DiveDay template it was copied from. The page binds the site id, and each action
 * re-validates it and scopes every read and write to the session's own shop, so a tampered id can
 * only name another of the staffer's own sites.
 */

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
  const refuse = (errorCode: SiteSaveRefusal): SiteFormState => ({
    errorCode,
    values: submittedValues(formData),
  });
  // Depth arrives in whatever unit this shop works in; metres is what's
  // stored. Re-read the shop rather than trusting a form field for the unit —
  // a hidden input would let a crafted post store a depth 3.3x off.
  const activeShop = await getShopById(await getDb(), activeSession.user.shopId);
  const parsed = parseDiveSiteForm(Object.fromEntries(formData), activeShop?.depthUnit ?? "meters");
  if (!parsed.ok) return refuse(parsed.error);
  const specialties = readRequiredSpecialties(formData);
  if (!specialties) return refuse("invalid");
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
  // **The admission fields are owner/manager work** (issue #3706). Everyone
  // else's form shows them read-only and posts them back as shown; a post
  // that would change one is refused whole, and an unchanged one keeps the
  // stored values exactly, so a feet-to-metres round trip never moves them.
  const submittedAdmission: DiveSiteAdmission = {
    minimumCertificationLevel: parsed.fields.minimumCertificationLevel,
    requiredSpecialties: specialties,
    requiresNitrox: extras.requiresNitrox,
    maxDepthMeters: parsed.maxDepthMeters,
  };
  const mayEditAdmission = await canPersonEditDiveSiteAdmission(
    activeDb,
    activeSession.user.shopId,
    activeSession.user.personId,
  );
  // **Checked before a single byte is uploaded**, and before the admission
  // comparison, so a tab someone else saved over reads as a conflict and not
  // as a forbidden change (security review of #3706). `dive-site-photos.ts`
  // says why in its own words: refusing after storing four photos leaves
  // objects nothing references. The authoritative check is still the one in
  // the `where` below, which is atomic with the write; this only stops the
  // wasted upload. A post from someone who may not change admission must
  // carry the version: without it the write below would put back admission
  // values read before a manager's change (security review of #3706).
  if (
    (extras.expectedVersion !== null && stored.rowVersion !== extras.expectedVersion) ||
    (extras.expectedVersion === null && !mayEditAdmission)
  ) {
    return refuse("conflict");
  }
  const storedAdmission: DiveSiteAdmission = {
    minimumCertificationLevel: stored.minimumCertificationLevel,
    requiredSpecialties: stored.requiredSpecialties,
    requiresNitrox: stored.requiresNitrox,
    maxDepthMeters: stored.maxDepthMeters,
  };
  if (
    !mayEditAdmission &&
    changedAdmissionFields(storedAdmission, submittedAdmission, activeShop?.depthUnit ?? "meters")
      .length > 0
  ) {
    return refuse("admissionManagersOnly");
  }
  const admission = mayEditAdmission ? submittedAdmission : storedAdmission;
  // **The briefing's Spanish rides the same Save** (visual review 2026-10-24,
  // A11), asked before anything is written: a box that would be refused has
  // to refuse the whole save while the briefing is still as it was.
  const spanish = await planSpanishBoxes(
    activeDb,
    activeSession.user.shopId,
    { kind: "dive_site", id },
    {
      description: { text: parsed.fields.description ?? "", maxLength: 1200 },
      marineLifeDescription: { text: parsed.fields.marineLifeDescription ?? "", maxLength: 1200 },
    },
    formData,
  );
  if (!spanish.ok) return refuse(spanish.reason === "stale" ? "spanishStale" : "spanishRefused");
  // Uploaded from the staffer's own device straight into first-party
  // storage — there is no pasted URL for a public page to fetch (CR-020).
  const photos = await uploadDiveSitePhotos(formData, stored);
  if (!photos.ok) {
    return refuse(photos.reason === "not_configured" ? "imagesUnconfigured" : "images");
  }
  // `minDepth`, `maxDepth` and `expectedBottomTime` are the form's own fields,
  // not columns — they became `parsed.depthMinMeters` / `parsed.maxDepthMeters` /
  // `parsed.expectedBottomTimeMinutes`, so none may reach the spread.
  const {
    minDepth: _minDepth,
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
  const updated = await editDiveSiteForForm(
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
      minimumCertificationLevel: admission.minimumCertificationLevel,
      requiredSpecialties: [...admission.requiredSpecialties],
      requiresNitrox: admission.requiresNitrox,
      difficultyLevel: parsed.difficultyLevel,
      snorkelSuitable: parsed.snorkelSuitable,
      depthRange: parsed.fields.depthRange,
      maxDepthMeters: admission.maxDepthMeters,
      depthMinMeters: parsed.depthMinMeters,
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
  await writeSpanishBoxes(
    activeDb,
    activeSession.user.shopId,
    { kind: "dive_site", id },
    spanish.boxes,
  );
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

/**
 * **Close a site for a while, or open it again** (loop 5, row 5). Two days and
 * a reason, both days blank to open it. Any staffer who may edit the site may
 * close it: the write is scoped to the session's shop, and a tampered id names
 * only another of its own sites.
 */
export async function closeDiveSiteAction(siteId: string, formData: FormData) {
  const activeSession = await requireStaffSession();
  const id = uuidParam(siteId);
  if (!id) notFound();
  const page = `${shopPath(activeSession.user.shopSlug, "dive-sites")}/${id}`;
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const parsed = parseServiceWindow({
    from: text("closedFrom"),
    until: text("closedUntil"),
    reason: text("closureReason"),
  });
  if (!parsed.ok) {
    revalidateAndRedirect(page, `${noticeUrl(page, "closure-invalid")}#site-closure-heading`);
    return;
  }
  const saved = await recordDiveSiteClosure(await getDb(), {
    shopId: activeSession.user.shopId,
    siteId: id,
    window: parsed.window,
  });
  if (!saved) notFound();
  revalidateAndRedirect(page, `${noticeUrl(page, "closure-saved")}#site-closure-heading`);
}

/**
 * A template pull or its undo rewrites the briefing wholesale, admission
 * fields included, so both are owner/manager work (issue #3706): everyone else
 * is sent back to the site with the reason.
 */
async function refuseTemplateWithoutAdmission(
  session: Awaited<ReturnType<typeof requireStaffSession>>,
  page: string,
) {
  const allowed = await canPersonEditDiveSiteAdmission(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) revalidateAndRedirect(page, noticeUrl(page, "admission-managers-only"));
}

export async function pullDiveSiteTemplateAction(siteId: string, formData: FormData) {
  const activeSession = await requireStaffSession();
  const id = uuidParam(siteId);
  if (!id) notFound();
  const back = shopPath(activeSession.user.shopSlug, "dive-sites");
  await refuseTemplateWithoutAdmission(activeSession, `${back}/${id}`);
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
  await refuseTemplateWithoutAdmission(activeSession, `${back}/${id}`);
  const result = await undoDiveSiteTemplateUpdate(await getDb(), activeSession.user.shopId, id);
  revalidateAndRedirect(
    `${back}/${id}`,
    noticeUrl(
      `${back}/${id}`,
      result.status === "undone" ? "template-undone" : "template-update-unavailable",
    ),
  );
}
