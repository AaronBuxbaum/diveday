import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EditorRail, UnsavedSections } from "@/components/editor/EditorRail";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  deleteDiveSite,
  getDiveSite,
  getDiveSiteTemplateUpdate,
  listDiveSiteCreatures,
  listUpcomingTripsForSite,
  pullDiveSiteTemplateUpdates,
  SITE_EDIT_CONFLICT,
  SITE_NAME_TAKEN,
  undoDiveSiteTemplateUpdate,
  updateDiveSiteForForm,
} from "@/db/dive-sites";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import type {
  DiveSiteTemplateField,
  DiveSiteTemplateUpdateMode,
} from "@/lib/dive-site-template-sync";
import { type DiveSiteFormError, parseDiveSiteForm, submittedValues } from "@/lib/dive-sites";
import { formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, noticeUrl, shopPath } from "@/lib/staff-notices";
import { supersededDiveSitePhotos, uploadDiveSitePhotos } from "@/lib/storage/dive-site-photos";
import { uuidParam } from "@/lib/uuid";
import { routeEditorCopy } from "../_components/route-editor-copy";
import { SiteFields } from "../_components/SiteFields";
import { SiteFormShell, type SiteFormState } from "../_components/SiteFormShell";
import {
  fieldGuideEditorCopy,
  landmarkEditorCopy,
  marineLifeCatalogEntries,
} from "../_components/site-editor-copy";
import { siteFormErrorMessages } from "../_components/site-form-errors";
import { siteFormSections, siteFormUnsavedCopy } from "../_components/site-form-sections";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Edit dive site — DiveDay" };

const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);

// A notice/error query param maps to a message key, never to a sentence — the
// words come from the staff bundle at render time (docs ADR
// 20260730-staff-copy-localization).
const NOTICE_KEYS: Record<string, StaffMessageKey> = {
  saved: "diveSites.edit.savedNotice",
  copied: "diveSites.edit.copiedNotice",
  "template-updated": "diveSites.edit.templateUpdates.updated",
  "template-replaced": "diveSites.edit.templateUpdates.replaced",
  "template-undone": "diveSites.edit.templateUpdates.undone",
  "template-update-unavailable": "diveSites.edit.templateUpdates.unavailable",
};

// Only the archive action still refuses through the URL; a rejected *save*
// hands its code back to the form instead (see `SiteFormShell`), which is what
// keeps a briefing's twenty fields from being wiped by their own error banner.
const ERROR_KEYS: Record<string, StaffMessageKey> = {
  invalid: "diveSites.edit.errorInvalid",
};

const TEMPLATE_FIELD_KEYS: Record<DiveSiteTemplateField, StaffMessageKey> = {
  description: "diveSites.edit.templateUpdates.fields.description",
  locationName: "diveSites.edit.templateUpdates.fields.locationName",
  forecastLatitude: "diveSites.edit.templateUpdates.fields.coordinates",
  forecastLongitude: "diveSites.edit.templateUpdates.fields.coordinates",
  marineLife: "diveSites.edit.templateUpdates.fields.marineLife",
  marineLifeDescription: "diveSites.edit.templateUpdates.fields.marineLifeDescription",
  difficultyLevel: "diveSites.edit.templateUpdates.fields.difficultyLevel",
  depthRange: "diveSites.edit.templateUpdates.fields.depthRange",
  maxDepthMeters: "diveSites.edit.templateUpdates.fields.maxDepthMeters",
  expectedBottomTimeMinutes: "diveSites.edit.templateUpdates.fields.expectedBottomTimeMinutes",
  currentNote: "diveSites.edit.templateUpdates.fields.currentNote",
  divePlan: "diveSites.edit.templateUpdates.fields.divePlan",
  fitTone: "diveSites.edit.templateUpdates.fields.fitTone",
  fitNote: "diveSites.edit.templateUpdates.fields.fitNote",
  conservationNote: "diveSites.edit.templateUpdates.fields.conservationNote",
  fieldGuideTipsHeading: "diveSites.edit.templateUpdates.fields.fieldGuideTipsHeading",
  landmarks: "diveSites.edit.templateUpdates.fields.landmarks",
  minimumCertificationLevel: "diveSites.edit.templateUpdates.fields.minimumCertificationLevel",
  requiredSpecialties: "diveSites.edit.templateUpdates.fields.requiredSpecialties",
  requiresNitrox: "diveSites.edit.templateUpdates.fields.requiresNitrox",
  creatures: "diveSites.edit.templateUpdates.fields.creatures",
};

export default async function EditDiveSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; error?: string; undo?: string }>;
}) {
  const { shopSlug, id } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(id)) notFound();
  const { notice, error, undo } = await searchParams;
  const back = shopPath(shopSlug, "dive-sites");
  const { db, shop } = await requireShopSurface(shopSlug);
  const site = await getDiveSite(db, shop.id, id);
  if (!site) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // The species picker previews what a *diver* will read off this site's
  // briefing, so its words come from the diver bundle -- in the staffer's own
  // language, resolved from the same locale.
  const diverT = diverTranslator(locale);
  const depthUnit = shop?.depthUnit ?? "meters";
  // Both params are attacker-supplied. The ternaries these replace also had a
  // second problem: their `else` branch meant *any* `?notice=` value at all —
  // including one this page never emits — rendered "Saved", claiming a save
  // that never happened. An unrecognized code now renders nothing.
  const noticeKey = noticeFromParam(notice, NOTICE_KEYS);
  const errorKey = noticeFromParam(error, ERROR_KEYS);
  const [upcomingTrips, creatures] = await Promise.all([
    listUpcomingTripsForSite(db, shop.id, id),
    listDiveSiteCreatures(db, shop.id, id),
  ]);
  const templateUpdate = await getDiveSiteTemplateUpdate(db, shop.id, id);

  async function saveAction(_state: SiteFormState, formData: FormData): Promise<SiteFormState> {
    "use server";
    const activeSession = await requireStaffSession();
    // Every refusal carries the whole submission back to the form, so an edit
    // in progress survives a rejected save (see `SiteFormShell`).
    const refuse = (errorCode: DiveSiteFormError): SiteFormState => ({
      errorCode,
      values: submittedValues(formData),
    });
    // Depth arrives in whatever unit this shop works in; metres is what's
    // stored. Re-read the shop rather than trusting a form field for the unit —
    // a hidden input would let a crafted post store a depth 3.3x off.
    // `await getDb()`, never the `db` closed over by the page: a server action
    // serializes what it captures, and handing it a live database client
    // recurses until the stack blows.
    const activeShop = await getShopById(await getDb(), activeSession.user.shopId);
    const parsed = parseDiveSiteForm(
      Object.fromEntries(formData),
      activeShop?.depthUnit ?? "meters",
    );
    if (!parsed.ok) return refuse(parsed.error);
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
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
    const sentVersion = Number.parseInt(String(formData.get("expectedVersion") ?? ""), 10);
    const expectedVersion = Number.isNaN(sentVersion) ? null : sentVersion;
    // **Checked before a single byte is uploaded.** `dive-site-photos.ts` says
    // why in its own words — refusing after storing four photos leaves objects
    // nothing references, and a refusal never gets far enough to persist their
    // URLs, so they are invisible to the unfinished-deletions panel too. The
    // authoritative check is still the one in the `where` below, which is
    // atomic with the write; this only stops the wasted upload.
    if (expectedVersion !== null && stored.rowVersion !== expectedVersion) {
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
      ...siteFields
    } = parsed.fields;
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
        minimumCertificationLevel: parsed.fields.minimumCertificationLevel,
        requiredSpecialties: specialties.data,
        requiresNitrox: formData.get("requiresNitrox") === "on",
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
        landmarks: parsed.landmarks,
        creatures: parsed.creatures,
        routePoints: parsed.route.points,
        routeLabel: parsed.route.label,
        routeNote: parsed.route.note,
        routeZoom: parsed.route.zoom,
      },
      { expectedVersion },
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
    // owner-visible if it fails (CR-012).
    for (const url of supersededDiveSitePhotos(stored, photos.photos)) {
      await queueAndAttemptMediaDeletion(activeDb, {
        shopId: activeSession.user.shopId,
        kind: "dive_site_photo",
        url,
      });
    }
    revalidateAndRedirect(`${back}/${id}`, noticeUrl(`${back}/${id}`, "saved"));
  }

  async function deleteAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const deleted = await deleteDiveSite(await getDb(), activeSession.user.shopId, id);
    revalidateAndRedirect(
      back,
      deleted ? noticeUrl(back, "deleted") : `${back}/${id}?error=invalid`,
    );
  }

  async function pullTemplateAction(formData: FormData) {
    "use server";
    const activeSession = await requireStaffSession();
    const mode = formData.get("mode");
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

  async function undoTemplateAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const result = await undoDiveSiteTemplateUpdate(await getDb(), activeSession.user.shopId, id);
    revalidateAndRedirect(
      `${back}/${id}`,
      noticeUrl(
        `${back}/${id}`,
        result.status === "undone" ? "template-undone" : "template-update-unavailable",
      ),
    );
  }

  const sections = siteFormSections(t);

  return (
    // Wider from `lg` up than the 3xl it was: the rail takes a column of its
    // own beside the form rather than out of it, so the fields keep the
    // measure they had (ADR 20260827-the-shops-shelves, the long-form editor
    // pattern).
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
      {/* Without this, `?notice=saved` stayed put and replayed "Saved" on every
          refresh and back-navigation — the same one-shot rule the rest of
          `/shop/**` follows. */}
      <FlashParams params={["notice", "error", "undo"]} />
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        {t("diveSites.backToLibrary")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
          title={site.name}
          description={t("diveSites.edit.description")}
          align="start"
          actions={
            <Link
              href={`/shop/${shopSlug}/schedule/board?add=1&site=${site.id}`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("diveSites.edit.scheduleDeparture")}
            </Link>
          }
        />
      </div>
      {/* Only "copied" is genuinely about the page: it lands the staffer on a
          *different* site's record, which is news the whole page carries. The
          save confirmation went to the form that earned it, and the archive
          refusal to the archive button. */}
      {noticeKey &&
      (notice === "copied" ||
        notice === "template-updated" ||
        notice === "template-replaced" ||
        notice === "template-undone" ||
        notice === "template-update-unavailable") ? (
        <p
          role={notice === "template-update-unavailable" ? "alert" : "status"}
          className={`mt-6 rounded-lg px-3 py-2 text-sm font-medium ${
            notice === "template-update-unavailable"
              ? "bg-danger-tint text-danger-strong"
              : "bg-success-tint text-success-strong"
          }`}
        >
          {t(noticeKey)}
        </p>
      ) : null}
      {undo === "true" && (notice === "template-updated" || notice === "template-replaced") ? (
        <UndoToast
          message={t("diveSites.edit.templateUpdates.undoMessage")}
          action={undoTemplateAction}
          fields={{}}
          pendingLabel={t("diveSites.edit.templateUpdates.undoing")}
          undoLabel={t("diveSites.edit.templateUpdates.undo")}
        />
      ) : null}
      {templateUpdate ? (
        <section className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
          <h2 className="text-base font-semibold">{t("diveSites.edit.templateUpdates.title")}</h2>
          <p className="mt-1 text-sm text-muted">
            {t("diveSites.edit.templateUpdates.description", {
              current: templateUpdate.currentVersion,
              latest: templateUpdate.latestVersion,
            })}
          </p>
          {templateUpdate.diff.length > 0 ? (
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {templateUpdate.diff.map((change) => (
                <li
                  key={change.field}
                  className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <span>{t(TEMPLATE_FIELD_KEYS[change.field])}</span>
                  <span className="shrink-0 text-xs font-medium text-muted">
                    {change.shopChanged
                      ? t("diveSites.edit.templateUpdates.shopEdit")
                      : t("diveSites.edit.templateUpdates.templateChange")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">
              {t("diveSites.edit.templateUpdates.noFieldChanges")}
            </p>
          )}
          <p className="mt-4 text-sm text-muted">
            {t("diveSites.edit.templateUpdates.replaceCopyHint")}
          </p>
          <form action={pullTemplateAction} className="mt-5">
            <input type="hidden" name="mode" value="replace-template-copy" />
            <SubmitButton
              pendingLabel={t("diveSites.edit.templateUpdates.replacing")}
              className={buttonClass()}
              confirmMessage={t("diveSites.edit.templateUpdates.replaceConfirm")}
            >
              {t("diveSites.edit.templateUpdates.replaceCopy")}
            </SubmitButton>
          </form>
        </section>
      ) : null}
      {upcomingTrips.length > 0 ? (
        <SectionCard title={t("diveSites.edit.upcomingHeading")} className="mt-8 overflow-hidden">
          {/* Full-bleed rows inside the card rather than a second bordered box
              inside it: each row pads itself and its hover fill has to reach
              the card's own edge, so the list undoes the card's padding and
              `overflow-hidden` clips that fill to the corner radius. */}
          <ul className="-mx-4 -mb-4 divide-y divide-border border-t border-border sm:-mx-5 sm:-mb-5">
            {upcomingTrips.map((trip) => (
              <li key={trip.tripId}>
                <Link
                  href={`/shop/${shopSlug}/trips/${trip.tripId}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-sunken"
                >
                  <span className="font-medium">{trip.title}</span>
                  <span className="text-muted">
                    {formatShortDate(trip.startsAt, locale, shop?.timezone ?? "UTC")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
      <div className="mt-8 lg:grid lg:grid-cols-[13.75rem_1fr] lg:gap-x-14">
        <EditorRail sections={sections} navLabel={t("diveSites.form.sectionsLabel")} />
        <div className="min-w-0">
          <SiteFormShell
            action={saveAction}
            errorMessages={siteFormErrorMessages(t, "diveSites.edit.errorInvalid")}
            savedMessage={notice === "saved" ? t("diveSites.edit.savedNotice") : undefined}
            actions={
              <>
                <SubmitButton pendingLabel={t("diveSites.form.saving")} className={buttonClass()}>
                  {t("diveSites.edit.saveBriefing")}
                </SubmitButton>
                <UnsavedSections sections={sections} copy={siteFormUnsavedCopy(t)} />
              </>
            }
          >
            {/* The row's edit generation as this render saw it, posted back so
                the save can refuse rather than quietly overwrite a colleague's
                briefing (issue #820). A site nobody has saved since the column
                arrived has a null `updated_at`, and `created_at` stands in for
                it — those are the rows two people are most likely to open at
                once. */}
            <input type="hidden" name="expectedVersion" value={String(site.rowVersion)} />
            <SiteFields
              t={t}
              depthUnit={depthUnit}
              values={{
                ...site,
                // Both lists are normalised for the editors rather than handed
                // over raw: a row written before landmarks carried notes holds
                // plain strings, and the guide lives in its own table.
                landmarks: parseDiveSiteLandmarks(site.landmarks),
                creatures: creatures.map((creature) => creature.catalogSlug ?? "").filter(Boolean),
              }}
              routeCopy={routeEditorCopy(t)}
              landmarkCopy={landmarkEditorCopy(t)}
              fieldGuideCopy={fieldGuideEditorCopy(t)}
              marineLifeCatalog={marineLifeCatalogEntries(diverT)}
              siteId={site.id}
              certificationDescription={t("diveSites.edit.certificationDescription")}
              requiredSpecialtiesLabel={t("diveSites.edit.requiredSpecialties")}
            />
          </SiteFormShell>
        </div>
      </div>
      <details
        open={Boolean(error)}
        className="mt-10 rounded-2xl border border-danger/30 bg-danger/5"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-danger [&::-webkit-details-marker]:hidden sm:px-5">
          <span>{t("diveSites.edit.deleteSite")}</span>
          <span aria-hidden="true" className="text-lg font-normal">
            +
          </span>
        </summary>
        <div className="border-t border-danger/20 p-4 text-sm sm:p-5">
          <h2 className="font-semibold">{t("diveSites.edit.deleteConfirmTitle")}</h2>
          <p className="mt-1 max-w-2xl text-muted">{t("diveSites.edit.deleteConfirmBody")}</p>
          <form action={deleteAction} className="mt-4">
            <SubmitButton
              pendingLabel={t("diveSites.edit.deleting")}
              className={buttonClass({ variant: "danger-solid" })}
            >
              {t("diveSites.edit.deleteSite")}
            </SubmitButton>
            <FormStatus tone="danger" className="mt-2">
              {error ? t(errorKey ?? "diveSites.edit.errorInvalid") : undefined}
            </FormStatus>
          </form>
        </div>
      </details>
    </main>
  );
}
