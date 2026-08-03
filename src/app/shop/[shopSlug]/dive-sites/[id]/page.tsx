import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  copyDiveSite,
  deleteDiveSite,
  getDiveSite,
  listDiveSites,
  listUpcomingTripsForSite,
  updateDiveSite,
} from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { depthInUnit, maxEnteredDepth } from "@/lib/depth-units";
import {
  type DiveSiteFormError,
  parseDiveSiteForm,
  splitMediaUrls,
  submittedValues,
} from "@/lib/dive-sites";
import { formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { ingestDiveSiteMedia } from "@/lib/storage/ingest-dive-site-media";
import { SiteFormShell, type SiteFormState } from "../_components/SiteFormShell";
import { siteFormErrorMessages } from "../_components/site-form-errors";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
  const { notice, error } = await searchParams;
  const back = `/shop/${shopSlug}/dive-sites`;
  const db = await getDb();
  const [site, shop] = await Promise.all([
    getDiveSite(db, session.user.shopId, id),
    getShopById(db, session.user.shopId),
  ]);
  if (!site) notFound();
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const depthUnit = shop?.depthUnit ?? "meters";
  // Both params are attacker-supplied. The ternaries these replace also had a
  // second problem: their `else` branch meant *any* `?notice=` value at all —
  // including one this page never emits — rendered "Saved", claiming a save
  // that never happened. An unrecognized code now renders nothing.
  const noticeKey = noticeFromParam(notice, NOTICE_KEYS);
  const errorKey = noticeFromParam(error, ERROR_KEYS);
  const upcomingTrips = await listUpcomingTripsForSite(db, session.user.shopId, id);

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
    let imageUrls: string[];
    try {
      imageUrls = splitMediaUrls(parsed.fields.imageUrls);
    } catch {
      return refuse("images");
    }
    const landmarks = parsed.fields.landmarks
      .split("\n")
      .map((landmark) => landmark.trim())
      .filter(Boolean);
    // Every media URL becomes first-party before it's ever stored — a public
    // dive-site page must never make a live request to a staff-pasted
    // third-party host (CR-020).
    const media = await ingestDiveSiteMedia({
      satelliteImageUrl: parsed.fields.satelliteImageUrl || undefined,
      routeImageUrl: parsed.fields.routeImageUrl || undefined,
      imageUrls,
    });
    if (!media.ok) {
      return refuse(media.reason === "not_configured" ? "imagesUnconfigured" : "images");
    }
    // `maxDepth` is the form's unit-relative field, not a column — it became
    // `parsed.maxDepthMeters`, so it must not reach the spread.
    const { maxDepth: _maxDepth, ...siteFields } = parsed.fields;
    const updated = await updateDiveSite(await getDb(), activeSession.user.shopId, id, {
      shopId: activeSession.user.shopId,
      ...siteFields,
      forecastLatitude:
        parsed.fields.forecastLatitude === "" ? null : parsed.fields.forecastLatitude,
      forecastLongitude:
        parsed.fields.forecastLongitude === "" ? null : parsed.fields.forecastLongitude,
      satelliteImageUrl: media.satelliteImageUrl,
      routeImageUrl: media.routeImageUrl,
      imageUrls: media.imageUrls,
      minimumCertificationLevel: parsed.fields.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      difficulty: parsed.fields.difficulty,
      depthRange: parsed.fields.depthRange,
      maxDepthMeters: parsed.maxDepthMeters,
      currentNote: parsed.fields.currentNote,
      divePlan: parsed.fields.divePlan,
      landmarks,
    });
    if (!updated) notFound();
    revalidateAndRedirect(`${back}/${id}`, `${back}/${id}?notice=saved`);
  }

  async function copyAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const activeDb = await getDb();
    const names = new Set(
      (await listDiveSites(activeDb, activeSession.user.shopId)).map((entry) => entry.name),
    );
    let copyName = `${site.name} copy`;
    let number = 2;
    while (names.has(copyName)) copyName = `${site.name} copy ${number++}`;
    const copy = await copyDiveSite(activeDb, activeSession.user.shopId, id, copyName);
    if (!copy) notFound();
    revalidateAndRedirect(back, `${back}/${copy.id}?notice=copied`);
  }

  async function deleteAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const deleted = await deleteDiveSite(await getDb(), activeSession.user.shopId, id);
    revalidateAndRedirect(
      back,
      deleted ? `${back}?notice=archived` : `${back}/${id}?error=invalid`,
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
          actions={
            <>
              <form action={copyAction}>
                <SubmitButton
                  pendingLabel={t("diveSites.edit.copying")}
                  className={buttonClass({ variant: "secondary", className: "text-foreground" })}
                >
                  {t("diveSites.edit.copyAndTailor")}
                </SubmitButton>
              </form>
              <details className="w-full sm:w-auto">
                <summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-danger/30 px-4 py-2 text-center text-sm font-medium text-danger">
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
                </form>
              </details>
            </>
          }
        />
      </div>
      {noticeKey ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          {t(noticeKey)}
        </p>
      ) : null}
      {error ? (
        <ShopNotice tone="danger" role="alert" className="mt-6">
          {t(errorKey ?? "diveSites.edit.errorInvalid")}
        </ShopNotice>
      ) : null}
      {upcomingTrips.length > 0 ? (
        <section aria-labelledby="upcoming-dives-heading" className="mt-8">
          <h2 id="upcoming-dives-heading" className="text-lg font-semibold">
            {t("diveSites.edit.upcomingHeading")}
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
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
        </section>
      ) : null}
      <SiteFormShell
        action={saveAction}
        errorMessages={siteFormErrorMessages(t, "diveSites.edit.errorInvalid")}
      >
        <FieldGrid columns={1}>
          <Field label={t("diveSites.form.nameLabel")}>
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={site.name}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">{t("diveSites.form.forecastLegend")}</legend>
          <p className="mt-1 text-sm text-muted">{t("diveSites.form.forecastDescription")}</p>
          <FieldGrid columns={2} className="mt-4 gap-y-5">
            <Field label={t("diveSites.form.latitudeLabel")}>
              <input
                name="forecastLatitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                defaultValue={site.forecastLatitude ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("diveSites.form.longitudeLabel")}>
              <input
                name="forecastLongitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                defaultValue={site.forecastLongitude ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>
        <FieldGrid columns={1} className="gap-y-5">
          <Field label={t("diveSites.form.locationLabel")} hint={t("diveSites.form.optionalHint")}>
            <input
              name="locationName"
              maxLength={160}
              defaultValue={site.locationName ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.descriptionLabel")}>
            <textarea
              name="description"
              rows={3}
              maxLength={1200}
              defaultValue={site.description ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-5">
          <Field label={t("diveSites.form.satelliteImageLabel")}>
            <textarea
              name="satelliteImageUrl"
              rows={2}
              defaultValue={site.satelliteImageUrl ?? ""}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("diveSites.form.routeImageLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <textarea
              name="routeImageUrl"
              rows={2}
              defaultValue={site.routeImageUrl ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1} className="gap-y-5">
          <Field
            label={t("diveSites.form.sitePhotosLabel")}
            hint={t("diveSites.form.sitePhotosHint")}
          >
            <textarea
              name="imageUrls"
              rows={4}
              defaultValue={site.imageUrls.join("\n")}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.marineLifeLabel")}>
            <input
              name="marineLife"
              maxLength={400}
              defaultValue={site.marineLife ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.briefingLabel")}>
            <textarea
              name="marineLifeDescription"
              rows={3}
              maxLength={1200}
              defaultValue={site.marineLifeDescription ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-5">
          <Field
            label={t("diveSites.form.difficultyLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <input
              name="difficulty"
              maxLength={120}
              defaultValue={site.difficulty ?? ""}
              placeholder={t("diveSites.form.difficultyPlaceholder")}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("diveSites.form.depthRangeLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <input
              name="depthRange"
              maxLength={120}
              defaultValue={site.depthRange ?? ""}
              placeholder={t("diveSites.form.depthRangePlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-5">
          {/* The one depth figure a certification ceiling can be compared
              against (H-08). Blank simply never warns — this advises, never gates. */}
          <Field
            label={t(
              depthUnit === "feet"
                ? "diveSites.form.maxDepthFeetLabel"
                : "diveSites.form.maxDepthMetersLabel",
            )}
            hint={t("diveSites.form.maxDepthHint")}
          >
            <input
              name="maxDepth"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxEnteredDepth(depthUnit)}
              step={1}
              defaultValue={
                site.maxDepthMeters === null ? "" : depthInUnit(site.maxDepthMeters, depthUnit)
              }
              placeholder={depthUnit === "feet" ? "60" : "18"}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1} className="gap-y-5">
          <Field
            label={t("diveSites.form.currentNoteLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <textarea
              name="currentNote"
              rows={2}
              maxLength={500}
              defaultValue={site.currentNote ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.divePlanLabel")} hint={t("diveSites.form.optionalHint")}>
            <textarea
              name="divePlan"
              rows={3}
              maxLength={1200}
              defaultValue={site.divePlan ?? ""}
              placeholder={t("diveSites.form.divePlanPlaceholder")}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("diveSites.form.landmarksLabel")}
            hint={t("diveSites.form.landmarksHint")}
          >
            <textarea
              name="landmarks"
              rows={3}
              maxLength={4000}
              defaultValue={site.landmarks.join("\n")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border bg-surface-sunken p-5">
          <legend className="px-1 text-sm font-medium">
            {t("diveSites.form.certificationLegend")}
          </legend>
          <p className="text-sm text-muted">{t("diveSites.edit.certificationDescription")}</p>
          <FieldGrid columns={1} className="mt-4">
            <Field label={t("diveSites.form.minimumCertificationLabel")}>
              <select
                name="minimumCertificationLevel"
                defaultValue={site.minimumCertificationLevel ?? ""}
                className={controlClass}
              >
                <option value="">{t("diveSites.form.noLevelRequired")}</option>
                {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <div className="mt-4">
            <p className="text-sm font-medium">{t("diveSites.edit.requiredSpecialties")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    name="specialty"
                    type="checkbox"
                    value={value}
                    defaultChecked={site.requiredSpecialties.includes(
                      value as keyof typeof SPECIALTY_KEYS,
                    )}
                    className="size-4 accent-primary"
                  />
                  {t(key)}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  name="requiresNitrox"
                  type="checkbox"
                  defaultChecked={site.requiresNitrox}
                  className="size-4 accent-primary"
                />
                {t("diveSites.form.nitroxCheckbox")}
              </label>
            </div>
          </div>
        </fieldset>
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
