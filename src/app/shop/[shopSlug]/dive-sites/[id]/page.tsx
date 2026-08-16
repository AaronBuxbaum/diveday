import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  deleteDiveSite,
  getDiveSite,
  listDiveSiteCreatures,
  listUpcomingTripsForSite,
  SITE_NAME_TAKEN,
  updateDiveSiteForForm,
} from "@/db/dive-sites";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { type DiveSiteFormError, parseDiveSiteForm, submittedValues } from "@/lib/dive-sites";
import { formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
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
};

// Only the archive action still refuses through the URL; a rejected *save*
// hands its code back to the form instead (see `SiteFormShell`), which is what
// keeps a briefing's twenty fields from being wiped by their own error banner.
const ERROR_KEYS: Record<string, StaffMessageKey> = {
  invalid: "diveSites.edit.errorInvalid",
};

export default async function EditDiveSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(id)) notFound();
  const { notice, error } = await searchParams;
  const back = shopPath(shopSlug, "dive-sites");
  const db = await getDb();
  const [site, shop] = await Promise.all([
    getDiveSite(db, session.user.shopId, id),
    getShopById(db, session.user.shopId),
  ]);
  if (!site) notFound();
  const locale = await requestLocale(shop?.defaultLocale);
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
    listUpcomingTripsForSite(db, session.user.shopId, id),
    listDiveSiteCreatures(db, session.user.shopId, id),
  ]);

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
    const updated = await updateDiveSiteForForm(activeDb, activeSession.user.shopId, id, {
      shopId: activeSession.user.shopId,
      ...siteFields,
      forecastLatitude: parsed.fields.forecastLatitude as number,
      forecastLongitude: parsed.fields.forecastLongitude as number,
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
      fitTone: parsed.fields.fitTone,
      fitNote: parsed.fields.fitNote,
      fieldGuideTipsHeading: parsed.fields.fieldGuideTipsHeading,
      landmarks: parsed.landmarks,
      creatures: parsed.creatures,
      routePoints: parsed.route.points,
      routeLabel: parsed.route.label,
      routeNote: parsed.route.note,
      routeZoom: parsed.route.zoom,
    });
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
      deleted ? noticeUrl(back, "archived") : `${back}/${id}?error=invalid`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* Without this, `?notice=saved` stayed put and replayed "Saved" on every
          refresh and back-navigation — the same one-shot rule the rest of
          `/shop/**` follows. */}
      <FlashParams params={["notice", "error"]} />
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        {t("diveSites.backToLibrary")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t("diveSites.catalogEyebrow")}
          title={site.name}
          description={t("diveSites.edit.description")}
          align="start"
          actions={
            <details className="w-full sm:w-auto">
              {/* The real `danger` variant, not a hand-copied approximation
                  of it: this string had drifted to `border-danger/30` where
                  the variant is `/40` and `py-2` where every other button on
                  the page is `py-2.5`, so the one destructive control here
                  read a shade lighter and a pixel shorter than the danger
                  buttons it opens. `w-full sm:w-auto` keeps the phone
                  behaviour the `<details>` around it already asks for, which
                  the block `flex` used to give for free. */}
              <summary
                className={`${buttonClass({
                  variant: "danger",
                  className: "w-full sm:w-auto",
                })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              >
                {t("diveSites.edit.archiveSite")}
              </summary>
              <form
                action={deleteAction}
                className="mt-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm sm:w-72"
              >
                <p className="text-muted">{t("diveSites.edit.archiveConfirmBody")}</p>
                <SubmitButton
                  pendingLabel={t("diveSites.edit.archiving")}
                  className={buttonClass({ variant: "danger-solid", className: "mt-3" })}
                >
                  {t("diveSites.edit.archiveSite")}
                </SubmitButton>
                {/* The archive refusal is the one thing on this page that
                    still travels by URL, and it belongs on the archive form
                    — not in a banner over a briefing the staffer never
                    touched. */}
                <FormStatus tone="danger" className="mt-2">
                  {error ? t(errorKey ?? "diveSites.edit.errorInvalid") : undefined}
                </FormStatus>
              </form>
            </details>
          }
        />
      </div>
      {/* Only "copied" is genuinely about the page: it lands the staffer on a
          *different* site's record, which is news the whole page carries. The
          save confirmation went to the form that earned it, and the archive
          refusal to the archive button. */}
      {notice === "copied" && noticeKey ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success-strong"
        >
          {t(noticeKey)}
        </p>
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
      <SiteFormShell
        action={saveAction}
        errorMessages={siteFormErrorMessages(t, "diveSites.edit.errorInvalid")}
        savedMessage={notice === "saved" ? t("diveSites.edit.savedNotice") : undefined}
      >
        <SiteFields
          t={t}
          depthUnit={depthUnit}
          values={{
            ...site,
            // Both lists are normalised for the editors rather than handed over
            // raw: a row written before landmarks carried notes holds plain
            // strings, and the guide lives in its own table.
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
        <SubmitButton
          pendingLabel={t("diveSites.form.saving")}
          className={buttonClass({ size: "lg", className: "mt-2 self-start text-base" })}
        >
          {t("diveSites.edit.saveBriefing")}
        </SubmitButton>
      </SiteFormShell>
    </main>
  );
}
