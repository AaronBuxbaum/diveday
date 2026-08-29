import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { canPersonManagePaymentSettings, canPersonRefund } from "@/db/authz";
import { listBoats } from "@/db/boats";
import { getTripGuests } from "@/db/trips-guests";
import { getTripOverview } from "@/db/trips-overview";
import { languageNameIn } from "@/i18n/language-labels";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DSD_RATIO } from "@/lib/course-ratios";
import { depthInUnit } from "@/lib/depth-units";
import { formatMoneyCents, formatShortDate, weekdayNames } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { fetchAutomatedMarineForecast, shouldShowAutomatedForecast } from "@/lib/marine-forecast";
import { toShopCurrency } from "@/lib/money";
import { publicTripPath } from "@/lib/public-routes";
import { recurrenceSummary, SERIES_HORIZON_DAYS } from "@/lib/recurrence";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { uuidParam } from "@/lib/uuid";
import { ConditionsSection } from "./_components/ConditionsSection";
import { CopyLinkButton } from "./_components/CopyLinkButton";
import { CrewSection } from "./_components/CrewSection";
import { DetailsSection } from "./_components/DetailsSection";
import { MinimumSeatsBand } from "./_components/MinimumSeatsBand";
import { PrintTripBundleButton } from "./_components/PrintTripBundleButton";
import { RequirementsSection } from "./_components/RequirementsSection";
import { recurrenceSummaryText, SeriesSection } from "./_components/SeriesSection";
import { TripAboutSection } from "./_components/TripAboutSection";
import { resolveTripNotice, TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripAddDiverLink, TripCapacityRing, TripPageHeader } from "./_components/TripPageHeader";
import { TripRosterContent } from "./_components/TripRosterContent";
import { TripSurfaceNav } from "./_components/TripSurfaceNav";
import {
  addInternalNoteAction,
  addToWaitlistAction,
  applySeriesDetailsAction,
  cancelOffCadenceSeriesAction,
  cancelSeriesAction,
  cancelTripAction,
  certifyDiverFromRosterAction,
  clearConditionsAction,
  confirmDiverIdentityAction,
  createDirectTripInvitationAction,
  deleteInternalNoteAction,
  inviteWaitlistAction,
  markPaymentAction,
  markWaiverInPersonAction,
  recordTripInvitationAction,
  recordTripPrintPdfAction,
  reinstateTripAction,
  removeBookingAction,
  restoreInternalNoteAction,
  saveConditionsAction,
  saveDetails,
  saveRequirementsAction,
  saveRosterEmergencyContactAction,
  sendLastMinuteDealAction,
  setSeriesRepeatAction,
  undoRemoveBookingAction,
  updateBookingPickupAction,
  updateSeriesCadenceAction,
  updateTripCrewAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Manage trip — DiveDay",
};

/**
 * Trip is the departure's working home: a compact About panel for its
 * definition followed by the grouped roster for the people coming. Manifest
 * remains who is aboard and Prep remains what is loaded. This is slice 5e from
 * ADR 20260827-the-departure-is-two-working-surfaces.
 *
 * The composition is masthead → three surface tabs → compact About → one
 * grouped roster ledger. The complete existing editors stay behind About's
 * disclosure, so moving the roster does not discard setup or lifecycle work.
 */
export default async function ManageTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    notice?: string;
    bid?: string;
    diverq?: string;
    inviteq?: string;
    count?: string;
    /** Which form on this page the notice answers — see `resolveTripNotice`. */
    form?: string;
    /** Signed, and verified against this route's own `id` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
    rf?: string;
    noteBookingId?: string;
    noteBody?: string;
    confirmName?: string;
    confirmEmail?: string;
    confirmPhone?: string;
  }>;
}) {
  const [
    { shopSlug, id: tripId },
    {
      notice,
      bid,
      diverq,
      count,
      form,
      gate,
      noteBookingId,
      noteBody,
      confirmName,
      confirmEmail,
      confirmPhone,
    },
  ] = await Promise.all([params, searchParams]);
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  // Locale and the trip row both depend on `shop` but not on each other.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const [overview, guests, shopBoats, mayDiscount, mayWriteOffPayment] = await Promise.all([
    getTripOverview(db, shop, tripId, session.user.personId),
    getTripGuests(db, shop, tripId, { diverQuery: diverq, confirmName }),
    // The fleet, for the Details form's hull select. Live hulls only: this is a
    // picker for what the departure will sail on, not a record of what it did
    // (`listBoatsForHistory` is the other one).
    shop.hasBoatDiving ? listBoats(db, shop.id) : [],
    canPersonManagePaymentSettings(db, shop.id, session.user.personId),
    canPersonRefund(db, shop.id, session.user.personId),
  ]);
  if (!overview || !guests) notFound();
  const {
    trip,
    cancelled,
    pulseNeeded,
    staff,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
    blowoutCalled,
    offCadence,
    diveSites,
    startWall,
    endWall,
    pulse,
    crew,
  } = overview;
  const { crewIds, tripRoleByPerson, crewGap, ratioGap, languageGap, onShiftIds } = crew;
  // Same tone as underTargetNote below: informs, refuses nothing (issue
  // #708). Each missing language is named in the reader's own locale
  // (`languageNameIn`), matching the team settings form's convention —
  // unlike the diver-facing badge, which uses each language's own endonym.
  const languageGapNote =
    languageGap.code === "none"
      ? null
      : t("trips.crew.languageGap", {
          languages: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
            languageGap.missing.map((code) => languageNameIn(code, locale) ?? code),
          ),
        });
  const underTargetNote =
    ratioGap.code === "none"
      ? null
      : t("trips.crew.underTarget", {
          divers: ratioGap.divers,
          divemasters: ratioGap.divemasterCount,
          ratio: shop.diversPerDivemaster,
          // The total the target wants, not the shortfall: "wants 1 more" than
          // none reads as arithmetic about nothing when the boat has no
          // divemaster at all, which is the case that matters most.
          needed: ratioGap.needed,
        });
  // Two rules, two sentences: the entry-level cap is PADI's published Open
  // Water training figure and a certified assistant raises it; the intro cap is
  // PADI's tighter published Discover Scuba open-water figure (HD-6) that an
  // assistant does not move. One generic string told a DSD manager to add a
  // divemaster, which cannot work, and cited the wrong PADI number at them. The
  // per-instructor figure is interpolated from `DSD_RATIO` so the sentence
  // cannot drift away from the cap the gate actually enforces.
  const overRatioWarning =
    crewGap.code !== "over_ratio"
      ? null
      : crewGap.ratio === "intro"
        ? t("trips.detail.overRatioWarningIntro", {
            booked: crewGap.booked,
            cap: crewGap.capacity,
            perInstructor: DSD_RATIO.openWaterStudentsPerInstructor,
          })
        : t("trips.detail.overRatioWarning", { booked: crewGap.booked, cap: crewGap.capacity });

  // One resolution, handed to the section it belongs to. Whatever no rendered
  // section claims — a page-level permission refusal, or a section this
  // staffer's role means we never rendered — falls through to the banner.
  const tripNotice = resolveTripNotice({ notice, count, form, gate, tripId, locale });
  const lifecycleStatus = noticeForForm(tripNotice, "lifecycle");

  // Capacity moved into the masthead ring in slice 5e. Non-seat pulse facts
  // remain as quiet links so the redesign changes their home and emphasis,
  // not the actions they lead to.
  const pulseFacts = pulseNeeded
    ? [
        ...(pulse.blocked > 0
          ? [
              {
                text: t("trips.pulse.blocked", { count: pulse.blocked }),
                // The ledger's "Still to clear" group leads the roster, so the
                // plain anchor lands on the blocked rows (slice 5d retired the
                // `?rf=` filter with the chips).
                href: `${shopPath(shopSlug, "trips", tripId)}#roster`,
                tone: "danger" as const,
              },
            ]
          : []),
        // A course session whose crew can't cover it is a can-this-boat-sail fact
        // in the pulse's exact register — until it surfaces here, the strip's
        // quiet reads as an all clear the Crew panel three screens down would
        // contradict. The panel keeps the full sentence; this is the door to it.
        ...(crewGap.code === "no_instructor"
          ? [
              {
                text: t("trips.pulse.needsInstructor"),
                href: "#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        ...(crewGap.code === "over_ratio"
          ? [
              {
                text: t("trips.pulse.overRatio"),
                href: "#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        ...(pulse.prepGaps > 0
          ? [
              {
                text: t("trips.pulse.prepGaps", { count: pulse.prepGaps }),
                href: shopPath(shopSlug, "trips", tripId, "prep"),
              },
            ]
          : []),
        // Money owed is work, not a boarding hazard — so it reads in the pulse's
        // neutral ink, below the facts that hold the boat up, and it is the one
        // fact here whose fix lives off the trip entirely. `range=all` because the
        // count is unwindowed: a seat sold months ahead was invoiced months ago,
        // and the index's default 90-day window would open on fewer orders than
        // the fact just promised.
        ...(pulse.openOrders > 0
          ? [
              {
                text: t("trips.pulse.awaitingPayment", { count: pulse.openOrders }),
                href: `${shopPath(shopSlug, "orders")}?tripId=${tripId}&status=open&range=all`,
              },
            ]
          : []),
      ]
    : [];

  const siteWithForecast = tripDiveList.find(
    ({ diveSite }) =>
      diveSite && diveSite.forecastLatitude !== null && diveSite.forecastLongitude !== null,
  )?.diveSite;
  const forecastPoint =
    siteWithForecast &&
    siteWithForecast.forecastLatitude !== null &&
    siteWithForecast.forecastLongitude !== null
      ? {
          latitude: siteWithForecast.forecastLatitude,
          longitude: siteWithForecast.forecastLongitude,
        }
      : null;
  const automatedForecast =
    forecastPoint && shouldShowAutomatedForecast(trip.startsAt)
      ? await fetchAutomatedMarineForecast(forecastPoint, trip.startsAt)
      : null;

  const aboutForms = new Set([
    "details",
    "requirements",
    "conditions",
    "crew",
    "series",
    "lifecycle",
  ]);
  const rosterForms = new Set(["roster", "add-diver", "last-minute-deal"]);
  const rootPageNotice =
    tripNotice && !aboutForms.has(tripNotice.form) && !rosterForms.has(tripNotice.form)
      ? tripNotice
      : undefined;
  const rosterPageNotice = tripNotice && tripNotice.form === "roster" ? tripNotice : undefined;
  const aboutOpen = Boolean(tripNotice && aboutForms.has(tripNotice.form));

  const siteNames = diveSites.sites.map((site) => site.name);
  const planSummary = siteNames.length > 0 ? siteNames.join(" + ") : t("trips.about.noneSet");
  const requirementsSummary =
    requirement === null
      ? t("trips.about.noRequirements")
      : [
          requirement.minimumCertificationLevel
            ? t("trips.requirements.summaryCert", {
                level: t(CERTIFICATION_LEVEL_KEYS[requirement.minimumCertificationLevel]),
              })
            : null,
          requirement.requiresWaiver ? t("trips.requirements.summaryWaiver") : null,
          !trip.course && requirement.requiresPayment
            ? t("trips.requirements.summaryPayment")
            : null,
          ...(!trip.course
            ? requirement.requiredSpecialties.map((specialty) =>
                t("trips.requirements.summarySpecialtyCard", {
                  specialty: t(SPECIALTY_KEYS[specialty]),
                }),
              )
            : []),
          !trip.course && requirement.requiresNitrox
            ? t("trips.requirements.summaryNitroxCard")
            : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · ") || t("trips.requirements.summaryNoneRequired");
  const conditionParts = [
    trip.conditionsSummary,
    trip.surfaceConditions,
    trip.visibilityMeters !== null
      ? t("trips.conditions.visibilityFact", {
          value: `${depthInUnit(trip.visibilityMeters, shop.depthUnit)} ${t(
            shop.depthUnit === "feet" ? "shared.depth.feet" : "shared.depth.meters",
          )}`,
        })
      : null,
  ].filter((part): part is string => Boolean(part));
  const conditionsSummary = trip.conditionsHold
    ? t("trips.conditions.holdOnSummary")
    : conditionParts.join(" · ") || t("trips.about.noConditions");
  const assignedCrew = staff
    .filter((entry) => crewIds.includes(entry.person.id))
    .map((entry) => entry.person.fullName);
  const boatName = shopBoats.find((boat) => boat.id === trip.boatId)?.name;
  const boatCrewSummary =
    [boatName, ...assignedCrew].filter(Boolean).join(" · ") || t("trips.about.noBoat");
  const repeatsSummary = series
    ? recurrenceSummaryText(
        t,
        locale,
        recurrenceSummary({
          intervalWeeks: series.intervalWeeks,
          weekdays: series.weekdayMask,
          endsOn: series.endsOn,
        }),
      )
    : t("trips.about.oneTime");
  const aboutSummary = [planSummary, boatCrewSummary, series ? repeatsSummary : null]
    .filter(Boolean)
    .join(" · ");
  const rosterActions = {
    addBookingAction: seatNewDiverAction.bind(null, "trip-guests", shopSlug),
    addExistingDiverAction: seatExistingDiverAction.bind(null, "trip-guests", shopSlug),
    addToWaitlistAction: addToWaitlistAction.bind(null, shopSlug, tripId),
    createDirectTripInvitationAction: createDirectTripInvitationAction.bind(null, shopSlug, tripId),
    markWaiverInPersonAction: markWaiverInPersonAction.bind(null, shopSlug, tripId),
    markPaymentAction: markPaymentAction.bind(null, shopSlug, tripId),
    removeBookingAction: removeBookingAction.bind(null, shopSlug, tripId),
    confirmDiverIdentityAction: confirmDiverIdentityAction.bind(null, shopSlug, tripId),
    certifyDiverAction: trip.course
      ? certifyDiverFromRosterAction.bind(null, shopSlug, tripId)
      : undefined,
    addInternalNoteAction: addInternalNoteAction.bind(null, shopSlug, tripId),
    deleteInternalNoteAction: deleteInternalNoteAction.bind(null, shopSlug, tripId),
    saveRosterEmergencyContactAction: saveRosterEmergencyContactAction.bind(null, shopSlug, tripId),
    updateBookingPickupAction: updateBookingPickupAction.bind(null, shopSlug, tripId),
    inviteWaitlistAction: inviteWaitlistAction.bind(null, shopSlug, tripId),
    recordTripInvitationAction: recordTripInvitationAction.bind(null, shopSlug, tripId),
    sendLastMinuteDealAction: sendLastMinuteDealAction.bind(null, shopSlug, tripId),
    undoRemoveBookingAction: undoRemoveBookingAction.bind(null, shopSlug, tripId),
    restoreInternalNoteAction: restoreInternalNoteAction.bind(null, shopSlug, tripId),
  };

  return (
    <>
      <FlashParams
        params={[
          "notice",
          "count",
          "form",
          "bid",
          "diverq",
          "inviteq",
          "rf",
          "noteBookingId",
          "noteBody",
          "confirmName",
          "confirmEmail",
          "confirmPhone",
        ]}
      />
      <TripPageHeader
        className="mb-5"
        boardHref={shopPath(shopSlug, "schedule", "board")}
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        trip={trip}
        locale={locale}
        timeZone={shop.timezone}
        price={
          trip.priceCents === null
            ? undefined
            : `${formatMoneyCents(trip.priceCents, toShopCurrency(shop.currency), locale)} ${t(
                "trips.about.perSeat",
              )}`
        }
        headerAside={
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <TripCapacityRing
              booked={trip.booked}
              capacity={trip.capacity}
              seatsLabel={t("trips.about.seatsLabel", { capacity: trip.capacity })}
              openLabel={t("trips.about.openLabel")}
            />
            {!cancelled ? (
              <TripAddDiverLink
                href="#add-diver"
                label={t("trips.addDiver.addDiver")}
                compactLabel={t("trips.about.add")}
                ariaLabel={t("trips.about.addDiverJump")}
              />
            ) : null}
          </div>
        }
        subNav={<TripSurfaceNav shopSlug={shopSlug} tripId={tripId} locale={locale} />}
      />

      <TripNoticeBanner notice={rootPageNotice} locale={locale} />

      {cancelled && (canConfigure || blowoutCalled || lifecycleStatus) ? (
        <section className="mt-6 rounded-2xl border border-danger/40 bg-danger/10 p-5">
          <FormStatus tone={lifecycleStatus?.tone} className="mb-3">
            {lifecycleStatus?.text}
          </FormStatus>
          <div className="flex flex-wrap items-center gap-3">
            {canConfigure ? (
              <form action={reinstateTripAction.bind(null, shopSlug, tripId)}>
                <SubmitButton
                  pendingLabel={t("trips.detail.reinstating")}
                  className={buttonClass()}
                >
                  {t("trips.detail.reinstate")}
                </SubmitButton>
              </form>
            ) : null}
            {blowoutCalled ? (
              <Link
                href={shopPath(shopSlug, "schedule", "blowout", tripId)}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("trips.detail.viewBlowout")}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <TripAboutSection
        heading={t("trips.about.heading")}
        detailsLabel={t("trips.about.details")}
        closeLabel={t("trips.about.close")}
        editLabel={t("trips.about.edit")}
        summary={aboutSummary || t("trips.about.noneSet")}
        conditionsSummary={conditionsSummary}
        open={aboutOpen}
        rows={[
          {
            label: t("trips.about.plan"),
            value: planSummary,
            editHref: canConfigure ? "#details" : undefined,
          },
          {
            label: t("trips.about.conditions"),
            value: conditionsSummary,
            editHref: "#conditions",
          },
          {
            label: t("trips.about.whoCanBook"),
            value: requirementsSummary,
            editHref: canConfigure ? "#requirements" : undefined,
          },
          {
            label: t("trips.about.boatAndCrew"),
            value: boatCrewSummary,
            editHref: "#crew",
          },
          {
            label: t("trips.about.repeats"),
            value: repeatsSummary,
            editHref: series ? "#series" : undefined,
          },
        ]}
        actions={
          <>
            <CopyLinkButton
              path={publicTripPath(shopSlug, tripId)}
              label={t("trips.detail.copyBookingLink")}
              copiedLabel={t("trips.detail.linkCopied")}
              failedLabel={t("trips.detail.linkCopyFailed")}
            />
            <Link
              href={publicTripPath(shopSlug, tripId)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {t("trips.about.viewPublic")}
            </Link>
            <PrintTripBundleButton
              href={shopPath(shopSlug, "trips", tripId, "print")}
              label={t("trips.about.printPacket")}
              popupBlockedLabel={t("shared.printButton.popupBlocked")}
              recordAction={recordTripPrintPdfAction.bind(null, shopSlug, tripId)}
            />
          </>
        }
        cancelAction={
          cancelled ? null : (
            <section className="w-full pt-1">
              <FormStatus tone={lifecycleStatus?.tone} className="mb-4">
                {lifecycleStatus?.text}
              </FormStatus>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={shopPath(shopSlug, "schedule", "blowout", tripId)}
                    className={buttonClass({ variant: "danger" })}
                  >
                    {t("trips.detail.weatherBlowout")}
                  </Link>
                  <p className="text-sm text-muted">{t("trips.detail.weatherBlowoutHint")}</p>
                </div>
                <form
                  action={cancelTripAction.bind(null, shopSlug, tripId)}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <SubmitButton
                    pendingLabel={t("trips.detail.cancelling")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("trips.about.cancel")}
                  </SubmitButton>
                  <p className="text-sm text-muted">{t("trips.detail.cancelHint")}</p>
                </form>
              </div>
            </section>
          )
        }
      >
        <div>
          {canConfigure ? (
            <DetailsSection
              action={saveDetails.bind(null, shopSlug, tripId)}
              status={noticeForForm(tripNotice, "details")}
              trip={trip}
              diveSiteList={diveSiteList}
              tripDiveList={tripDiveList}
              startWall={startWall}
              endWall={endWall}
              dayCount={Math.max(1, scheduleDays.length)}
              locale={locale}
              currency={toShopCurrency(shop.currency)}
              warnNoPrice={!cancelled}
              boats={shopBoats.map((boat) => ({ id: boat.id, name: boat.name }))}
              hasBoatDiving={shop.hasBoatDiving}
              hasShoreDiving={shop.hasShoreDiving}
              hasPoolDiving={shop.hasPoolDiving}
              embedded
            />
          ) : null}

          {/* Ops before content: what the trip requires and who runs it are what a
          staffer opening an upcoming departure needs next, so they follow the
          details directly — the crew's day-of prediction reads after them. */}
          {canConfigure ? (
            <RequirementsSection
              action={saveRequirementsAction.bind(null, shopSlug, tripId)}
              status={noticeForForm(tripNotice, "requirements")}
              trip={trip}
              requirement={requirement}
              siteRequirement={siteRequirement}
              siteNames={diveSites.sites.map((site) => site.name)}
              locale={locale}
              embedded
            />
          ) : null}

          {/* Who's aboard is manifest accuracy (glossary) — open to all staff.
          Per-person assign/unassign (updateTripCrewAction), the same mutation
          the schedule board uses — not a whole-set replace — so two staff
          editing crew at once can no longer clobber each other (Lens 17 task
          139). */}
          <CrewSection
            shopSlug={shopSlug}
            tripId={tripId}
            staff={staff}
            crewIds={crewIds}
            crewRoles={Object.fromEntries(tripRoleByPerson)}
            // A cancelled departure isn't sailing, so its crew panel drops the
            // live-trip nudges — the ratio gates, the shop's target, and the
            // shift-coverage badges are all about a boat that will leave.
            onShiftIds={cancelled ? null : onShiftIds}
            crewGapCode={cancelled ? "none" : crewGap.code}
            updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
            copy={{
              heading: t("trips.crew.heading"),
              courseNeedsInstructor: t("trips.crew.courseNeedsInstructor"),
              overRatioWarning,
              underTargetNote: cancelled ? null : underTargetNote,
              languageGapNote: cancelled ? null : languageGapNote,
              noStaff: t("trips.crew.noCrew"),
              notAssignedYet: t("trips.crew.notAssignedYet"),
              assignLabel: t("trips.crew.assignLabel"),
              assignOption: t("trips.crew.assignOption"),
              unassignAria: t.raw("trips.crew.unassignAria"),
              assignFailed: t("trips.crew.assignFailed"),
              roleAria: t.raw("trips.crew.roleAria"),
              roleUnspecified: t("trips.crew.roleUnspecified"),
              roleOptions: {
                instructor: t("trips.crew.roleInstructor"),
                divemaster: t("trips.crew.roleDivemaster"),
                captain: t("trips.crew.roleCaptain"),
                crew: t("trips.crew.roleCrew"),
              },
              onShift: t("trips.crew.onShift"),
              notOnShift: t("trips.crew.notOnShift"),
              manageShifts: t("trips.crew.manageShifts"),
            }}
            embedded
          />

          {/* Conditions are crew-entered (glossary) — open to all staff. Its
          fields are uncontrolled (`defaultValue`, not `value`), so a save or
          clear that lands via a same-route re-render rather than a fresh
          mount leaves the old value on screen — the same
          cacheComponents-can-skip-a-remount class ADR
          20260802-cache-components-cross-render-state and ADR
          20260801-cache-components-activity-state both hit, just in the
          opposite direction (unresettable state that needs a forced remount,
          not state that needs to survive one). Keying on the fields
          themselves (not `conditionsUpdatedAt`, which the e2e harness's
          frozen clock would hold identical across a save-then-clear in the
          same test) forces the remount `defaultValue` needs on any actual
          change to what these inputs show, republish-with-different-values
          included — not just the set/cleared transition this bug was found on. */}
          <ConditionsSection
            key={[
              trip.waterTemperatureC,
              trip.visibilityMeters,
              trip.surfaceConditions,
              trip.conditionsSummary,
            ].join("|")}
            saveAction={saveConditionsAction.bind(null, shopSlug, tripId)}
            clearAction={clearConditionsAction.bind(null, shopSlug, tripId)}
            status={noticeForForm(tripNotice, "conditions")}
            trip={trip}
            locale={locale}
            timezone={shop.timezone}
            temperatureUnit={temperatureUnitFor(shop)}
            depthUnit={shop.depthUnit}
            automatedForecast={automatedForecast}
            embedded
          />

          {canConfigure && series ? (
            <SeriesSection
              intervalWeeks={series.intervalWeeks}
              weekdays={series.weekdayMask}
              endsOn={series.endsOn}
              anchorDate={series.anchorDate}
              futureScheduledCount={series.futureScheduledCount}
              horizonDays={SERIES_HORIZON_DAYS}
              offCadence={offCadence.map((date) => ({
                id: date.id,
                title: date.title,
                // Formatted here, where the request locale and the shop's zone both
                // are — the panel is handed words, never instants.
                label: formatShortDate(date.startsAt, locale, shop.timezone),
                booked: date.booked,
              }))}
              weekdayNames={weekdayNames(locale)}
              status={noticeForForm(tripNotice, "series")}
              applyAction={applySeriesDetailsAction.bind(null, shopSlug, tripId, series.id)}
              cancelAction={cancelSeriesAction.bind(null, shopSlug, tripId, series.id)}
              repeatAction={setSeriesRepeatAction.bind(null, shopSlug, tripId, series.id)}
              cadenceAction={updateSeriesCadenceAction.bind(null, shopSlug, tripId, series.id)}
              cancelOffCadenceAction={cancelOffCadenceSeriesAction.bind(
                null,
                shopSlug,
                tripId,
                series.id,
              )}
              locale={locale}
              embedded
            />
          ) : null}
        </div>
      </TripAboutSection>

      {pulseNeeded ? (
        <MinimumSeatsBand
          trip={trip}
          booked={trip.booked}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
      ) : null}

      {pulseFacts.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {pulseFacts.map((fact) => (
            <Link
              key={fact.href}
              href={fact.href}
              className={`inline-flex min-h-11 items-center text-sm font-medium hover:underline ${
                fact.tone === "danger" ? "text-danger" : "text-primary"
              }`}
            >
              {fact.text}
            </Link>
          ))}
        </div>
      ) : null}

      <TripRosterContent
        guests={guests}
        shopSlug={shopSlug}
        shopName={shop.name}
        locale={locale}
        timezone={shop.timezone}
        depthUnit={shop.depthUnit}
        tripNotice={tripNotice}
        pageNotice={rosterPageNotice}
        noteDeleted={
          noteBookingId && noteBody ? { bookingId: noteBookingId, body: noteBody } : undefined
        }
        confirmName={confirmName}
        confirmEmail={confirmEmail}
        confirmPhone={confirmPhone}
        undoBookingId={
          notice?.startsWith("booking-removed") && notice !== "booking-removed-refunded"
            ? bid
            : undefined
        }
        keepOpenBookingId={
          notice === "contact-saved" || notice === "contact-incomplete" || notice === "payment"
            ? bid
            : undefined
        }
        mayDiscount={mayDiscount}
        mayWriteOffPayment={mayWriteOffPayment}
        compact
        actions={rosterActions}
      />
    </>
  );
}
