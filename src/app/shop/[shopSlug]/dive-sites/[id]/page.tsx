import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { UnsavedSections } from "@/components/editor/EditorRail";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { DangerDisclosure, DisclosureRow, DisclosureRowList } from "@/components/ui/disclosure";
import { FormStatus } from "@/components/ui/form";
import {
  getDiveSite,
  getDiveSiteTemplateUpdate,
  listDiveSiteCreatures,
  listUpcomingTripsForSite,
} from "@/db/dive-sites";
import { listTripDives } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { staffTideWindowText } from "@/i18n/tide-labels";
import { tideWindowsForDeparture } from "@/lib/departure-tides";
import { parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { parseDockDayRhythm } from "@/lib/diver-planning";
import { formatTime } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { fetchTideStation, tideStationEcho } from "@/lib/tide-stations";
import { uuidParam } from "@/lib/uuid";
import { routeEditorCopy } from "../_components/route-editor-copy";
import { loadSiteAssists, siteBriefAssist, siteSpanishFields } from "../_components/SiteAssists";
import { SiteFields } from "../_components/SiteFields";
import { SiteFormShell } from "../_components/SiteFormShell";
import { ERROR_KEYS, NOTICE_KEYS } from "../_components/site-edit-notices";
import {
  fieldGuideEditorCopy,
  landmarkEditorCopy,
  marineLifeCatalogEntries,
} from "../_components/site-editor-copy";
import { siteFormErrorMessages } from "../_components/site-form-errors";
import { siteFormSections, siteFormUnsavedCopy } from "../_components/site-form-sections";
import { UpcomingSiteTrips } from "../_components/UpcomingSiteTrips";
// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import {
  deleteDiveSiteAction,
  pullDiveSiteTemplateAction,
  saveDiveSiteAction,
  undoDiveSiteTemplateAction,
} from "./actions";
import { TemplateValueComparison } from "./TemplateValueComparison";

export const instant = true;

export { librarySiteRouteMetadata as generateMetadata } from "../dive-site-page-metadata";

/**
 * How many of the upcoming departures carry a tide line (ADR
 * 20260907-noaa-tide-predictions). One week of a daily reef trip: far enough
 * that a captain planning the week reads it on every row they care about,
 * short enough that the page never queues a NOAA request per row down a list
 * that runs to the series horizon.
 */
const TIDE_LINE_DEPARTURES = 7;

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
  const assists = await loadSiteAssists(db, shop, site);
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
  // What NOAA calls the station this site carries, and whether it sits
  // anywhere near the site's own coordinates (issue #1468, ADR
  // 20260907-noaa-tide-predictions' 2026-09-10 amendment). Read here in the
  // *render* rather than in `saveDiveSiteAction`, which is what makes "a failed lookup
  // never blocks a save" structural rather than careful: the save writes the
  // id, redirects back, and this render is where the echo appears. `null` for
  // a site with no station, an id NOAA does not know, or a lookup that timed
  // out — all three render nothing.
  const station = site.tideStationId ? await fetchTideStation(site.tideStationId) : null;
  // The tide at *this* site on each upcoming departure that dives it, read at
  // the instant the boat gets there rather than at departure (ADR
  // 20260907-noaa-tide-predictions). Empty for a site with no station, which
  // is most of them, and the list renders exactly as it did.
  //
  // Only the soonest few, and all of them at once. This list has no end — a
  // daily reef trip materializes a departure a day out to the series horizon —
  // and every distinct local day is its own NOAA request, so walking the whole
  // list in order would put a four-second bound on the page once per row. The
  // rows a captain plans tides against are the next ones; the rest read as they
  // did before this feature.
  const rhythm = parseDockDayRhythm(shop);
  const tideLineByTrip = new Map<string, string>();
  if (site.tideStationId && rhythm) {
    const lines = await Promise.all(
      upcomingTrips.slice(0, TIDE_LINE_DEPARTURES).map(async (trip) => {
        const dives = await listTripDives(db, shop.id, trip.tripId);
        const windows = await tideWindowsForDeparture({
          startsAt: trip.startsAt,
          plannedDives: trip.plannedDives,
          diveMode: trip.diveMode,
          dives: dives.map(({ dive, diveSite }) => ({
            diveNumber: dive.diveNumber,
            travelMinutes: dive.travelMinutes,
            // Only this site's own dive carries a station here: the row is
            // about this site, and a second stationed site on the same day
            // belongs to its own page.
            site:
              diveSite && diveSite.id === site.id
                ? {
                    name: diveSite.name,
                    tideStationId: diveSite.tideStationId,
                    tidePreference: diveSite.tidePreference,
                    expectedBottomTimeMinutes: diveSite.expectedBottomTimeMinutes,
                  }
                : diveSite
                  ? {
                      name: diveSite.name,
                      tideStationId: null,
                      tidePreference: "any",
                      expectedBottomTimeMinutes: diveSite.expectedBottomTimeMinutes,
                    }
                  : null,
          })),
          rhythm,
          timeZone: shop.timezone,
        });
        const first = windows[0];
        if (!first) return null;
        return [
          trip.tripId,
          staffTideWindowText(
            t,
            first.window,
            first.preference,
            formatTime(first.window.nearestTurn.at, locale, shop.timezone),
          ),
        ] as const;
      }),
    );
    for (const line of lines) {
      if (line) tideLineByTrip.set(line[0], line[1]);
    }
  }

  const sections = siteFormSections(t, shop.fieldGuideEnabled);

  return (
    // The form's own measure: the jump rail that widened this page from `lg`
    // up is gone (visual review 2026-10-24, A11).
    <StaffPage width="reading">
      {/* Without this, `?notice=saved` stayed put and replayed "Saved" on every
          refresh and back-navigation — the same one-shot rule the rest of
          `/shop/**` follows. */}
      <FlashParams params={["notice", "error", "undo"]} />
      <div>
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
          eyebrowHref={back}
          title={site.name}
          description={t("diveSites.edit.description")}
          descriptionIsCaption
          // The default `end`: a static door sits at the foot of the title
          // block, as on every records header; `start` is for actions that
          // grow, and hung this one from the eyebrow (K-491).
          actions={
            <Link
              href={`/shop/${shopSlug}/schedule/board?add=1&site=${site.id}`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("diveSites.edit.scheduleDeparture")}
            </Link>
          }
        />
      </div>
      {/* Only "copied" needs a page-level notice; form feedback stays with its control. */}
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
              ? "bg-danger-tint text-danger"
              : "bg-success-tint text-success-strong"
          }`}
        >
          {t(noticeKey)}
        </p>
      ) : null}
      {undo === "true" && (notice === "template-updated" || notice === "template-replaced") ? (
        <UndoToast
          message={t("diveSites.edit.templateUpdates.undoMessage")}
          action={undoDiveSiteTemplateAction.bind(null, id)}
          fields={{}}
          pendingLabel={t("diveSites.edit.templateUpdates.undoing")}
          undoLabel={t("diveSites.edit.templateUpdates.undo")}
          dismissLabel={t("shared.undoToast.dismiss")}
        />
      ) : null}
      <UpcomingSiteTrips
        trips={upcomingTrips}
        tideLineByTrip={tideLineByTrip}
        shopSlug={shopSlug}
        locale={locale}
        timeZone={shop.timezone}
        t={t}
      />
      <div className="mt-8">
        <SiteFormShell
          action={saveDiveSiteAction.bind(null, id)}
          errorMessages={siteFormErrorMessages(t, "diveSites.edit.errorInvalid")}
          savedMessage={notice === "saved" ? t("diveSites.edit.savedNotice") : undefined}
          actions={
            <>
              <SubmitButton pendingLabel={t("diveSites.form.saving")} className={buttonClass()}>
                {t("diveSites.form.save")}
              </SubmitButton>
              <UnsavedSections
                sections={sections}
                copy={siteFormUnsavedCopy(t, shop.fieldGuideEnabled)}
              />
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
            fieldGuideOn={shop.fieldGuideEnabled}
            t={t}
            depthUnit={depthUnit}
            tideStation={tideStationEcho(station, site)}
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
            locale={locale}
            timezone={shop.timezone}
            siteId={site.id}
            certificationDescription={t("diveSites.edit.certificationDescription")}
            requiredSpecialtiesLabel={t("diveSites.edit.requiredSpecialties")}
            briefAssist={siteBriefAssist(shopSlug, assists.canAssist, t)}
            spanish={siteSpanishFields(shopSlug, assists, t)}
          />
        </SiteFormShell>
      </div>
      {/* A newer DiveDay template for this site: closed behind its name under
          the briefing, because pulling one is rare and its own act (visual
          review 2026-10-24, A11). Outside the briefing form: forms cannot nest. */}
      {templateUpdate ? (
        <DisclosureRowList className="mt-8">
          <DisclosureRow id="briefing-template" heading={t("diveSites.edit.templateUpdates.title")}>
            <p className="text-sm text-muted">
              {t("diveSites.edit.templateUpdates.description", {
                current: templateUpdate.currentVersion,
                latest: templateUpdate.latestVersion,
              })}
            </p>
            {templateUpdate.diff.length > 0 ? (
              <TemplateValueComparison
                changes={templateUpdate.diff}
                fieldGuideOn={shop.fieldGuideEnabled}
                depthUnit={depthUnit}
                locale={locale}
                t={t}
                diverT={diverT}
              />
            ) : (
              <p className="mt-4 text-sm text-muted">
                {t("diveSites.edit.templateUpdates.noFieldChanges")}
              </p>
            )}
            <p className="mt-4 text-sm text-muted">
              {t("diveSites.edit.templateUpdates.replaceCopyHint")}
            </p>
            <form action={pullDiveSiteTemplateAction.bind(null, id)} className="mt-5">
              <input type="hidden" name="mode" value="replace-template-copy" />
              <SubmitButton
                pendingLabel={t("diveSites.edit.templateUpdates.replacing")}
                className={buttonClass()}
                confirmMessage={t("diveSites.edit.templateUpdates.replaceConfirm")}
              >
                {t("diveSites.edit.templateUpdates.replaceCopy")}
              </SubmitButton>
            </form>
          </DisclosureRow>
        </DisclosureRowList>
      ) : null}
      <DangerDisclosure
        open={Boolean(error)}
        className="mt-10 print:hidden"
        summary={t("diveSites.edit.deleteSite")}
      >
        <h2 className="font-semibold">{t("diveSites.edit.deleteConfirmTitle")}</h2>
        <p className="mt-1 max-w-2xl text-muted">{t("diveSites.edit.deleteConfirmBody")}</p>
        <form action={deleteDiveSiteAction.bind(null, id)} className="mt-4">
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
      </DangerDisclosure>
    </StaffPage>
  );
}
