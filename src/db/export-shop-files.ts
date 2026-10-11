import { calendarDateInTimezone } from "@/lib/calendar-date";
import { EXPORT_FILE_NOTES } from "@/lib/export";
import { WEEKDAY_EXPORT_CODES, weekdaysIn } from "@/lib/recurrence";
import type { ShopExportContext } from "./export";
import {
  BOOKING_ARRIVAL_EVENTS_CSV,
  BOOKING_CHECKOUT_BOOKINGS_CSV,
  BOOKING_PAYMENT_EVENTS_CSV,
  BOOKINGS_CSV,
  BUDDY_PAIRS_CSV,
  CERTIFICATIONS_CSV,
  COURSE_FORM_RECORDS_CSV,
  COURSE_INQUIRIES_CSV,
  CUSTOMER_GEAR_ITEMS_CSV,
  DIVE_PACKAGE_ENTITLEMENTS_CSV,
  GEAR_RESERVATIONS_CSV,
  IMPORTED_PAYMENT_HISTORY_CSV,
  LAST_MINUTE_LIST_CSV,
  NITROX_CERTIFICATIONS_CSV,
  NOTIFICATION_DELIVERIES_CSV,
  ORDER_LINE_ITEMS_CSV,
  ORDERS_CSV,
  PRIOR_VISITS_CSV,
  RECAP_PHOTOS_CSV,
  RENTAL_FIT_CSV,
  REVIEW_MODERATION_EVENTS_CSV,
  ROLL_CALL_EVENTS_CSV,
  SPECIALTY_CERTIFICATIONS_CSV,
  shopFile,
  TIPS_CSV,
  TRIP_INVITATIONS_CSV,
  TRIP_LAST_MINUTE_PROMO_RECIPIENTS_CSV,
  TRIP_REVIEWS_CSV,
  WAITLIST_ENTRIES_CSV,
  WAIVER_RECORDS_CSV,
  WORK_ORDER_CARE_CSV,
  WORK_ORDER_LINES_CSV,
  WORK_ORDERS_CSV,
} from "./export-shared-files";
import type { ExportFileSpec } from "./export-tables";
import { certificationLevel } from "./schema";

/**
 * **The shop bundle, file by file** (ADR 20260722-full-shop-export): every
 * CSV `loadShopExportBundleInput` writes, in bundle order, each with its
 * header, its README note and how its rows are built from what the loader
 * read. Nothing here queries; `loadShopExportContext` in `./export` reads
 * everything once, inside the bundle's one repeatable-read transaction, and
 * each entry below takes only the reads it names.
 *
 * The order of this list is the order of the files in the bundle, and
 * `EXPORT_FILE_NOTES` (src/lib/export.ts) is the same list again for the
 * settings page and the README — `export.test.ts` holds the three together.
 */

/**
 * "Best card" for the flat contacts file: verified evidence before pending
 * claims, then the highest rung — a shop leaving with this file should hand
 * its next system the strongest honest claim per diver.
 */
function bestCertification<
  Card extends {
    level: (typeof certificationLevel.enumValues)[number];
    status: string;
  },
>(cards: Card[]): Card | undefined {
  const rank = (card: Card) =>
    (card.status === "verified" ? 1000 : 0) + certificationLevel.enumValues.indexOf(card.level);
  return cards.reduce<Card | undefined>(
    (best, card) => (!best || rank(card) > rank(best) ? card : best),
    undefined,
  );
}

/**
 * The most recent live (non-superseded) *completed* waiver for the flat
 * contacts file — a diver's round-trippable "has this shop's waiver on
 * file" signal for another DiveDay shop's importer. `medical_review` never
 * counts as accepted here: a live physician-referral hold must never be
 * mistaken for clearance by a downstream import (the importer's own
 * dedup/currency check is a second, independent guard against the same
 * mistake, but the export must not hand out a misleading signal either).
 */
function bestWaiver<
  Record extends {
    status: string;
    supersededAt: Date | null;
    signedAt: Date | null;
    completedAt: Date | null;
  },
>(records: Record[]): Record | undefined {
  const completed = records.filter((r) => r.status === "completed" && !r.supersededAt);
  const at = (r: Record) => (r.signedAt ?? r.completedAt)?.getTime() ?? 0;
  return completed.reduce<Record | undefined>(
    (best, r) => (!best || at(r) > at(best) ? r : best),
    undefined,
  );
}

/** Best-effort first/last split for import wizards; full_name stays authoritative. */
function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { first: fullName.trim(), last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export const SHOP_EXPORT_FILES: ExportFileSpec<ShopExportContext>[] = [
  {
    file: "shop.csv",
    header: [
      "name",
      "slug",
      "timezone",
      "default_locale",
      // Without this the whole export is ambiguous: every other file's
      // `*_cents` column is a count of *this* currency's minor unit, and
      // a bare 13000 is $130.00 or ¥13,000 depending on it.
      "currency",
      "tax_enabled",
      "pass_through_fee",
      "medical_jurisdiction",
      "depth_unit",
      "temperature_unit",
      "has_boat_diving",
      "has_shore_diving",
      "has_pool_diving",
      // The shop's target diver-to-divemaster ratio, stored as the divers
      // half (ADR 20260820-shop-divemaster-ratio). The bundle is also the
      // backup, and a shop restoring from one must come back planning and
      // crewing against its own number rather than the default.
      "divers_per_divemaster",
      "crew_schedule_enabled",
      // Which optional features the shop switched off (ADR
      // 20261005-optional-shop-features): a restore must not quietly
      // turn reviews or tips back on for a shop that chose not to ask.
      "reviews_enabled",
      "date_requests_enabled",
      "last_minute_list_enabled",
      "tips_enabled",
      "contact_email",
      "contact_phone",
      "address_street",
      "address_locality",
      "address_region",
      "address_postal_code",
      "address_country",
      "dock_call_minutes",
      // The rest of the shop's dock-day rhythm (ADR
      // 20260812-configurable-dock-day-rhythm). Six numbers that describe
      // how this shop runs a day — as much the shop's own record as its
      // packing list, and re-importable as one.
      "gear_setup_minutes",
      "briefing_minutes",
      "boat_ride_minutes",
      "bottom_time_minutes",
      "surface_interval_minutes",
      "review_url",
      "packing_list",
      "rental_items",
      "rental_pricing",
      // The shop's own words on every rental ticket (ADR
      // 20260815-minimal-gear-register, amended 2026-10-08): its text, so its
      // backup carries it.
      "rental_terms",
      // The shop's own emergency numbers. Exported because the bundle is
      // the backup: a shop restoring from one must come back with the
      // chamber's number on its manifests, not an empty card.
      "emergency_reference",
      // Where the shop's season starts (ADR
      // 20260904-reef-all-the-way-down, Budget rule 3). Exported because
      // it is a date the shop chose, and a restore that silently put it
      // back on 1 January would make the home's one fact of scale count
      // from a year the shop never named.
      "season_start_month",
      "season_start_day",
      // When somebody is at the desk, a window the shop chose (the
      // after-hours ping, `src/lib/desk-hours.ts`). Exported for the reason
      // the season is: a restore must not quietly move the shop's hours.
      "desk_opens_minute",
      "desk_closes_minute",
      // Whether the shop asked to stay out of search engines
      // (ADR 20260813-search-listing-is-a-choice). Exported because the
      // bundle is also the *backup*: a shop that opted out and later
      // restored from one must not come back published.
      "search_listing_opt_out_at",
      "tagline",
      "description",
      "logo_url",
      "brand_color",
      "brand_display_font",
      "brand_hero_image_url",
      "brand_hero_image_alt",
      "shopfront_photo_urls",
      "established_year",
      "brand_badges",
      "created_at",
    ],
    rows: ({ shop }) => [
      [
        shop.name,
        shop.slug,
        shop.timezone,
        shop.defaultLocale,
        shop.currency,
        shop.taxEnabled,
        JSON.stringify(shop.passThroughFee),
        shop.jurisdiction,
        shop.depthUnit,
        shop.temperatureUnit,
        shop.hasBoatDiving,
        shop.hasShoreDiving,
        shop.hasPoolDiving,
        shop.diversPerDivemaster,
        shop.crewScheduleEnabled,
        shop.reviewsEnabled,
        shop.dateRequestsEnabled,
        shop.lastMinuteListEnabled,
        shop.tipsEnabled,
        shop.contactEmail,
        shop.contactPhone,
        shop.addressStreet,
        shop.addressLocality,
        shop.addressRegion,
        shop.addressPostalCode,
        shop.addressCountry,
        shop.dockCallMinutes,
        shop.gearSetupMinutes,
        shop.briefingMinutes,
        shop.boatRideMinutes,
        shop.bottomTimeMinutes,
        shop.surfaceIntervalMinutes,
        shop.reviewUrl,
        JSON.stringify(shop.packingList),
        JSON.stringify(shop.rentalItems),
        JSON.stringify(shop.rentalPricing),
        shop.rentalTerms,
        JSON.stringify(shop.emergencyReference),
        shop.seasonStartMonth,
        shop.seasonStartDay,
        shop.deskOpensMinute,
        shop.deskClosesMinute,
        shop.searchListingOptOutAt,
        shop.tagline,
        shop.description,
        shop.logoUrl,
        shop.brandColor,
        shop.brandDisplayFont,
        shop.brandHeroImageUrl,
        shop.brandHeroImageAlt,
        JSON.stringify(shop.shopfrontPhotoUrls),
        shop.establishedYear,
        JSON.stringify(shop.brandBadges),
        shop.createdAt,
      ],
    ],
    note: EXPORT_FILE_NOTES["shop.csv"],
  },
  {
    file: "boats.csv",
    header: [
      "id",
      "name",
      "capacity",
      "description",
      "certified_passengers",
      "inspection_due_on",
      "registration_expires_on",
      "insurance_expires_on",
      "created_at",
    ],
    rows: ({ boatRows }) =>
      boatRows.map((row) => [
        row.id,
        row.name,
        row.capacity,
        row.description,
        row.certifiedPassengers,
        row.inspectionDueOn,
        row.registrationExpiresOn,
        row.insuranceExpiresOn,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["boats.csv"],
  },
  {
    file: "trip_lenses.csv",
    header: ["id", "name", "slug", "created_at", "deleted_at"],
    rows: ({ tripLensRows }) =>
      tripLensRows.map((row) => [row.id, row.name, row.slug, row.createdAt, row.deletedAt]),
    note: EXPORT_FILE_NOTES["trip_lenses.csv"],
  },
  {
    file: "contacts.csv",
    header: [
      "first_name",
      "last_name",
      "full_name",
      "email",
      "phone",
      "roles",
      "date_of_birth",
      "emergency_contact_name",
      "emergency_contact_phone",
      "certification_agency",
      "certification_level",
      "certification_number",
      "certification_status",
      // **"Said they hold no card" is not the same fact as "was never
      // asked", and in this file they were byte-identical.** The four
      // certification columns above are blank for both, which is the exact
      // ambiguity `people.no_certification_declared_at` exists to remove —
      // reintroduced for the reader most likely to act on it, since a
      // destination system importing this file prompts staff to "complete"
      // a blank record and a shop reading it in a spreadsheet reads a gap
      // as an oversight.
      //
      // It sits here, beside the certification columns, and deliberately
      // **never** as a value inside `certification_level` or
      // `certification_agency`: a "none" rung is the `certifications`-row
      // mistake the ADR refuses, one file format down, and the first
      // importer to sort or rank that column would put it on the ladder.
      "no_certification_declared_at",
      "nitrox_certified",
      "bcd_size",
      "wetsuit_size",
      "boot_size",
      "fin_size",
      "waiver_accepted",
      "waiver_signed_at",
      "waiver_source_name",
      "deleted_at",
      "created_at",
    ],
    rows: ({
      shop,
      peopleRows,
      personRolesText,
      cardsByPerson,
      nitroxVerified,
      fitByPerson,
      cardedPeople,
      waiversByPerson,
    }) =>
      peopleRows.map((row) => {
        const name = splitName(row.fullName);
        const card = bestCertification(cardsByPerson.get(row.id) ?? []);
        const fit = fitByPerson.get(row.id);
        const waiver = bestWaiver(waiversByPerson.get(row.id) ?? []);
        const waiverSignedAt = waiver
          ? calendarDateInTimezone(
              waiver.signedAt ?? waiver.completedAt ?? row.createdAt,
              shop.timezone,
            )
          : null;
        return [
          name.first,
          name.last,
          row.fullName,
          row.email,
          row.phone,
          personRolesText(row.id),
          row.dateOfBirth,
          row.emergencyContactName,
          row.emergencyContactPhone,
          card?.agency,
          card?.level,
          card?.identifier,
          card?.status,
          // Blank unless the answer still stands: cleared by a staffer,
          // refuted by a card the shop holds, or contradicted by the very
          // level this row is already exporting, and this file says nothing.
          // contacts.csv is the *interpreted* row — "the strongest honest
          // claim per diver" — so it must not hand a destination system both
          // a card and a statement that there is no card and leave it to
          // arbitrate. people.csv carries the raw pair for anyone auditing.
          //
          // The `card` test is the one `cardedPeople` cannot do and is not
          // redundant with it. A diver may declare "no card" and later
          // declare a *rung*: the writer keeps both flags and the staff
          // reader renders the rung as the later, more specific statement,
          // but `bestCertification` above ranks a still-unsighted claim too,
          // so without this the same row would ship `certification_level`
          // **and** "there is no card" (`dive-domain-expert`, 2026-08-15).
          row.noCertificationDeclaredAt &&
          !row.noCertificationClearedAt &&
          !cardedPeople.has(row.id) &&
          !card
            ? row.noCertificationDeclaredAt
            : null,
          nitroxVerified.has(row.id),
          fit?.bcdSize,
          fit?.wetsuitSize,
          fit?.bootSize,
          fit?.finSize,
          Boolean(waiver),
          waiverSignedAt,
          waiver?.signatureMethod === "imported" ? waiver.importedFromLabel : null,
          row.deletedAt,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["contacts.csv"],
  },
  {
    file: "people.csv",
    header: [
      "id",
      "full_name",
      "email",
      "phone",
      "roles",
      "date_of_birth",
      "dive_insurance",
      "emergency_contact_name",
      "emergency_contact_phone",
      // Staff-only in practice — set from the team settings form — but
      // the column lives on every row (issue #708), so it dumps here
      // like every other fact this file carries regardless of who it's
      // ever actually populated for.
      "spoken_languages",
      // A staff member's own agreement to be named to divers on the
      // departures they crew (issue #1181). Same call as the languages
      // above and for the same reason: it is a fact about a person this
      // shop holds, so the shop's own copy of everything carries it.
      "crew_public_consent_at",
      // The string that consent actually publishes (issue #1351). It
      // travels beside the stamp because it is half of the same record:
      // a shop restoring this bundle needs to know not just that somebody
      // agreed, but to what.
      "crew_public_name",
      "courtesy_email_opt_out_at",
      // The diver's own "I'm not certified yet", which is a statement
      // about them and not a card — it has no row in certifications.csv
      // to travel in, so it travels here or not at all (ADR
      // 20260814-self-declared-cards).
      "no_certification_declared_at",
      // And the correction, when a staffer said the diver never gave that
      // answer. Both halves travel because this is the normalized dump:
      // a cleared stamp is *superseded*, not deleted (people.no_certification_cleared_at),
      // so a file that carried only the first column would re-assert a
      // statement the shop has withdrawn. contacts.csv, which interprets
      // rather than dumps, resolves the pair down to one cell.
      "no_certification_cleared_at",
      "no_certification_cleared_by_person_id",
      // A staffer's "18 or older" at a split, and whose (H-100): the age
      // answer the guardian rule read when no date was on file.
      "adult_attested_at",
      "adult_attested_by_person_id",
      // **Where this record came from.** Set once, when a diver put
      // themselves on file at the shop's counter QR rather than being
      // typed in by staff (issue #1236). It changes how a destination
      // system should read every other cell on the row — a name and a
      // level nobody has sighted — so it travels with them.
      "self_registered_at",
      "deleted_at",
      // Erasure travels with the bundle (ADR 20260802-diver-data-erasure).
      // Every identifying column above is already blank for such a row, so
      // without these two the destination system cannot tell a diver who
      // was erased from one whose details were simply never collected —
      // and would happily prompt staff to "complete" the record.
      "anonymized_at",
      "anonymized_by_person_id",
      // A merged-away row remains in the normalized export as a
      // redirect, so an audit or destination import can preserve the
      // original person id without resurrecting the duplicate.
      "merged_into_person_id",
      "merged_at",
      "merged_by_person_id",
      "created_at",
    ],
    rows: ({ peopleRows, personRolesText }) =>
      peopleRows.map((row) => [
        row.id,
        row.fullName,
        row.email,
        row.phone,
        personRolesText(row.id),
        row.dateOfBirth,
        row.diveInsurance,
        row.emergencyContactName,
        row.emergencyContactPhone,
        row.spokenLanguages.length > 0 ? [...row.spokenLanguages].sort().join("; ") : null,
        row.crewPublicConsentAt,
        row.crewPublicName,
        row.courtesyEmailOptOutAt,
        row.noCertificationDeclaredAt,
        row.noCertificationClearedAt,
        row.noCertificationClearedByPersonId,
        row.adultAttestedAt,
        row.adultAttestedByPersonId,
        row.selfRegisteredAt,
        row.deletedAt,
        row.anonymizedAt,
        row.anonymizedByPersonId,
        row.mergedIntoPersonId,
        row.mergedAt,
        row.mergedByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["people.csv"],
  },
  shopFile(CERTIFICATIONS_CSV),
  shopFile(SPECIALTY_CERTIFICATIONS_CSV),
  shopFile(NITROX_CERTIFICATIONS_CSV),
  {
    file: "trips.csv",
    header: [
      "id",
      "title",
      "status",
      // Beside the status it qualifies: a shop reading its own history
      // wants to know *when* a departure was called off, not only that it
      // was. Null for anything cancelled before the column existed.
      "cancelled_at",
      "starts_at",
      "ends_at",
      "capacity",
      "planned_dives",
      "price_cents",
      "deposit_cents",
      // The snorkeler and rider seats and the divers-only limit (ADR
      // 20261007-participant-types). Null means not stated.
      "snorkeler_price_cents",
      "rider_price_cents",
      "diver_capacity",
      "cancellation_window_hours",
      "minimum_bookings",
      "minimum_decision_hours",
      "series_id",
      "series_occurrence_date",
      "course_id",
      "dive_site_id",
      "dive_site_name",
      "dive_mode",
      "boat_id",
      "boat_name",
      // The shop's own word for this kind of day, as an id into
      // trip_lenses.csv.
      "lens_id",
      "conditions_hold",
      "conditions_summary",
      "water_temperature_c",
      "visibility_meters",
      "surface_conditions",
      "conditions_updated_at",
      "description",
      // Where this departure meets, when it isn't the shop's own front
      // door (issue #704 slice 2) — both empty means "the shop".
      "meeting_point_label",
      "meeting_point_address",
      "arrival_landmark",
      "arrival_parking_note",
      "arrival_transit_note",
      "arrival_look_for",
      "arrival_first_interaction",
      "arrival_photo_url",
      "is_private",
      // The shop's own answer about this departure, not a derived fact,
      // so it leaves with the shop (issue #973).
      "self_guided",
      // The bundle carries deleted departures (they are still the shop's
      // rows), so it has to carry the stamp that says which — a file that
      // hands back a deleted departure looking live is worse than one
      // that left it out.
      "deleted_at",
      "created_at",
    ],
    rows: ({ siteName, tripRows, boatName }) =>
      tripRows.map((row) => [
        row.id,
        row.title,
        row.status,
        row.cancelledAt,
        row.startsAt,
        row.endsAt,
        row.capacity,
        row.plannedDives,
        row.priceCents,
        row.depositCents,
        row.snorkelerPriceCents,
        row.riderPriceCents,
        row.diverCapacity,
        row.cancellationWindowHours,
        row.minimumBookings,
        row.minimumDecisionHours,
        row.seriesId,
        row.seriesOccurrenceDate,
        row.courseId,
        row.diveSiteId,
        row.diveSiteId ? siteName.get(row.diveSiteId) : null,
        row.diveMode,
        row.boatId,
        row.boatId ? boatName.get(row.boatId) : null,
        row.lensId,
        row.conditionsHold,
        row.conditionsSummary,
        row.waterTemperatureC,
        row.visibilityMeters,
        row.surfaceConditions,
        row.conditionsUpdatedAt,
        row.description,
        row.meetingPointLabel,
        row.meetingPointAddress,
        row.arrivalLandmark,
        row.arrivalParkingNote,
        row.arrivalTransitNote,
        row.arrivalLookFor,
        row.arrivalFirstInteraction,
        row.arrivalPhotoUrl,
        row.isPrivate,
        row.selfGuided,
        row.deletedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["trips.csv"],
  },
  {
    file: "trip_change_events.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "kind",
      "source",
      "before_value",
      "after_value",
      "actor_person_id",
      "actor_name",
      "occurred_at",
      "seq",
    ],
    rows: ({ personName, tripTitle, tripStartsAt, tripChangeEventRows }) =>
      tripChangeEventRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.kind,
        row.source,
        row.beforeValue ? JSON.stringify(row.beforeValue) : null,
        JSON.stringify(row.afterValue),
        row.actorPersonId,
        row.actorPersonId ? personName.get(row.actorPersonId) : null,
        row.occurredAt,
        row.seq,
      ]),
    note: EXPORT_FILE_NOTES["trip_change_events.csv"],
  },
  {
    file: "trip_stage_events.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "stage",
      "dive_site_id",
      "recorded_by_person_id",
      "recorder_name",
      "recorded_at",
      "seq",
    ],
    rows: ({ personName, tripTitle, tripStartsAt, tripStageEventRows }) =>
      tripStageEventRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.stage,
        row.diveSiteId,
        row.recordedByPersonId,
        personName.get(row.recordedByPersonId),
        row.recordedAt,
        row.seq,
      ]),
    note: EXPORT_FILE_NOTES["trip_stage_events.csv"],
  },
  {
    file: "trip_series.csv",
    header: [
      "id",
      "title",
      "frequency",
      "interval_weeks",
      // The stored value is a bitmask; the CSV carries the days a person
      // can read, because a shop opening this in a spreadsheet is owed
      // "mon,thu" rather than "18" (src/lib/recurrence.ts).
      "weekdays",
      "weekday_mask",
      "anchor_date",
      "ends_on",
      "occurrence_count",
      "last_rolled_at",
      "created_at",
    ],
    rows: ({ seriesRows }) =>
      seriesRows.map((row) => [
        row.id,
        row.title,
        row.frequency,
        row.intervalWeeks,
        weekdaysIn(row.weekdayMask)
          .map((day) => WEEKDAY_EXPORT_CODES[day])
          .join(","),
        row.weekdayMask,
        row.anchorDate,
        row.endsOn,
        row.occurrenceCount,
        row.lastRolledAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_series.csv"],
  },
  {
    file: "trip_series_skips.csv",
    header: ["series_id", "series_title", "occurrence_date", "created_at"],
    rows: ({ seriesTitle, seriesSkipRows }) =>
      seriesSkipRows.map((row) => [
        row.seriesId,
        seriesTitle.get(row.seriesId) ?? null,
        row.occurrenceDate,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_series_skips.csv"],
  },
  {
    file: "trip_schedule_days.csv",
    header: ["trip_id", "trip_title", "day_number", "starts_at", "ends_at"],
    rows: ({ tripTitle, scheduleDayRows }) =>
      scheduleDayRows.map(({ trip_schedule_days: row }) => [
        row.tripId,
        tripTitle.get(row.tripId),
        row.dayNumber,
        row.startsAt,
        row.endsAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_schedule_days.csv"],
  },
  {
    file: "trip_dives.csv",
    header: [
      "trip_id",
      "trip_title",
      "dive_number",
      "title",
      "dive_site_id",
      "dive_site_name",
      "description",
      // How long the boat runs to reach this dive's site — from the dock
      // for dive one, from the previous dive's site after that. Empty
      // means the leg reads the shop's own `boat_ride_minutes`
      // (ADR 20260815-per-leg-travel-minutes).
      "travel_minutes",
    ],
    rows: ({ siteName, tripTitle, tripDiveRows }) =>
      tripDiveRows.map((row) => [
        row.tripId,
        tripTitle.get(row.tripId),
        row.diveNumber,
        row.title,
        row.diveSiteId,
        row.diveSiteId ? siteName.get(row.diveSiteId) : null,
        row.description,
        row.travelMinutes,
      ]),
    note: EXPORT_FILE_NOTES["trip_dives.csv"],
  },
  {
    file: "trip_requirements.csv",
    header: [
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "requires_waiver",
      "minimum_certification_level",
      "required_specialties",
      "requires_nitrox",
      "requires_payment",
      "updated_at",
    ],
    rows: ({ tripTitle, tripStartsAt, orderedRequirementRows }) =>
      orderedRequirementRows.flatMap((row) =>
        row
          ? [
              [
                row.tripId,
                tripTitle.get(row.tripId),
                tripStartsAt.get(row.tripId),
                row.requiresWaiver,
                row.minimumCertificationLevel,
                row.requiredSpecialties.join("; "),
                row.requiresNitrox,
                row.requiresPayment,
                row.updatedAt,
              ],
            ]
          : [],
      ),
    note: EXPORT_FILE_NOTES["trip_requirements.csv"],
  },
  {
    file: "trip_assignments.csv",
    header: [
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "person_id",
      "person_name",
      "roles",
      "trip_role",
    ],
    rows: ({ personName, personRolesText, tripTitle, tripStartsAt, assignmentRows }) =>
      assignmentRows.map((row) => [
        row.tripId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.personId,
        personName.get(row.personId),
        personRolesText(row.personId),
        row.tripRole,
      ]),
    note: EXPORT_FILE_NOTES["trip_assignments.csv"],
  },
  {
    file: "staff_shifts.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "starts_at",
      "ends_at",
      "note",
      "created_by_person_id",
      "created_by_name",
      "created_at",
    ],
    rows: ({ personName, staffShiftRows }) =>
      staffShiftRows.map(({ staff_shifts: row }) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.startsAt,
        row.endsAt,
        row.note,
        row.createdByPersonId,
        row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["staff_shifts.csv"],
  },
  {
    file: "crew_availability_blocks.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "starts_on",
      "ends_on",
      "note",
      "created_by_person_id",
      "created_by_name",
      "created_at",
    ],
    rows: ({ personName, crewAwayRows }) =>
      crewAwayRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.startsOn,
        row.endsOn,
        row.note,
        row.createdByPersonId,
        personName.get(row.createdByPersonId),
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["crew_availability_blocks.csv"],
  },
  {
    file: "crew_assignment_requests.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "person_id",
      "person_name",
      "requested_at",
      "decision",
      "decided_at",
      "decided_by_person_id",
      "decided_by_name",
      "created_at",
    ],
    rows: ({ personName, tripTitle, crewRequestRows }) =>
      crewRequestRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        row.personId,
        personName.get(row.personId),
        row.requestedAt,
        row.decision,
        row.decidedAt,
        row.decidedByPersonId,
        row.decidedByPersonId ? personName.get(row.decidedByPersonId) : null,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["crew_assignment_requests.csv"],
  },
  {
    file: "staff_credentials.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "kind",
      "name",
      "issuing_body",
      "identifier",
      "issued_at",
      "renews_at",
      "status",
      "review_note",
      "reviewed_at",
      "reviewed_by_person_id",
      "deleted_at",
      "deleted_by_person_id",
      "created_at",
      "updated_at",
    ],
    rows: ({ personName, staffCredentialRows }) =>
      staffCredentialRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.kind,
        row.name,
        row.issuingBody,
        row.identifier,
        row.issuedAt,
        row.renewsAt,
        row.status,
        row.reviewNote,
        row.reviewedAt,
        row.reviewedByPersonId,
        row.deletedAt,
        row.deletedByPersonId,
        row.createdAt,
        row.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["staff_credentials.csv"],
  },
  shopFile(BOOKINGS_CSV),
  {
    file: "trip_help_requests.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "booking_id",
      "person_id",
      "person_name",
      "kind",
      "status",
      "created_at",
      "updated_at",
      "acknowledged_at",
      "handled_at",
      "resolved_by_person_id",
      "resolved_by_name",
    ],
    rows: ({ personName, tripTitle, tripStartsAt, bookingPerson, tripHelpRequestRows }) =>
      tripHelpRequestRows.map((row) => {
        const personId = bookingPerson.get(row.bookingId) ?? null;
        return [
          row.id,
          row.tripId,
          tripTitle.get(row.tripId),
          tripStartsAt.get(row.tripId),
          row.bookingId,
          personId,
          personId ? personName.get(personId) : null,
          row.kind,
          row.status,
          row.createdAt,
          row.updatedAt,
          row.acknowledgedAt,
          row.handledAt,
          row.resolvedByPersonId,
          row.resolvedByPersonId ? personName.get(row.resolvedByPersonId) : null,
        ];
      }),
    note: EXPORT_FILE_NOTES["trip_help_requests.csv"],
  },
  shopFile(WAITLIST_ENTRIES_CSV),
  shopFile(TRIP_INVITATIONS_CSV),
  shopFile(LAST_MINUTE_LIST_CSV),
  {
    file: "trip_last_minute_promos.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "status",
      "discount_percent",
      "discount_amount_cents",
      "code",
      "expires_at",
      "recipient_count",
      "created_by_person_id",
      "created_by_name",
      "created_at",
    ],
    rows: ({ personName, lastMinutePromoRows, tripTitle, tripStartsAt }) =>
      lastMinutePromoRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.status,
        row.discountPercent,
        row.discountAmountCents,
        row.code,
        row.expiresAt,
        row.recipientCount,
        row.createdByPersonId,
        row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_last_minute_promos.csv"],
  },
  shopFile(TRIP_LAST_MINUTE_PROMO_RECIPIENTS_CSV),
  shopFile(BOOKING_PAYMENT_EVENTS_CSV),
  {
    file: "booking_checkouts.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "status",
      "stripe_session_id",
      "customer_email",
      "promo_code_id",
      "trip_promo_id",
      "promo_code",
      "applied_discount_percent",
      "applied_discount_cents",
      "currency",
      "amount_per_diver_cents",
      "total_cents",
      "pass_through_cents",
      "tax_enabled",
      "tax_cents",
      "settled_total_cents",
      "refunded_cents",
      "is_deposit",
      "abandoned_recovery_sent_at",
      "expires_at",
      "completed_at",
      "async_payment_failed_at",
      "created_at",
    ],
    rows: ({ tripTitle, tripStartsAt, checkoutRows }) =>
      checkoutRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.status,
        row.stripeSessionId,
        row.customerEmail,
        row.promoCodeId,
        row.tripPromoId,
        row.promoCode,
        row.appliedDiscountPercent,
        row.appliedDiscountCents,
        row.currency,
        row.amountPerDiverCents,
        row.totalCents,
        row.passThroughCents,
        row.taxEnabled,
        row.taxCents,
        row.settledTotalCents,
        row.refundedCents,
        row.isDeposit,
        row.abandonedRecoverySentAt,
        row.expiresAt,
        row.completedAt,
        row.asyncPaymentFailedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["booking_checkouts.csv"],
  },
  shopFile(BOOKING_CHECKOUT_BOOKINGS_CSV),
  {
    file: "executed_dives.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "dive_number",
      "actual_site_id",
      "actual_site_name",
      "entered_at",
      "exited_at",
      "max_depth_meters",
      "observed_conditions",
      "not_recorded",
      // One species a crew member said they saw on this dive (issue
      // #1190). A catalog slug rather than a name, because the words are
      // DiveDay's copy in the reader's language and a CSV has no reader
      // to resolve them for — the slug is the durable fact.
      "observed_species_slug",
      // Why the boat did not dive the plan, and the shop's own note about
      // it (issue #1184). The reason is a code for the same reason the
      // species slug above is; the note is the shop's own words and
      // belongs in a bundle the shop is handed back.
      "plan_change_reason",
      "plan_change_note",
      "recorded_by_person_id",
      "deleted_at",
      "created_at",
      "updated_at",
    ],
    rows: ({ siteName, tripTitle, executedDiveRows }) =>
      executedDiveRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        row.diveNumber,
        row.actualSiteId,
        row.actualSiteId ? siteName.get(row.actualSiteId) : null,
        row.enteredAt,
        row.exitedAt,
        row.maxDepthMeters,
        JSON.stringify(row.observedConditions),
        JSON.stringify(row.notRecorded),
        row.observedSpeciesSlug,
        row.planChangeReason,
        row.planChangeNote,
        row.recordedByPersonId,
        row.deletedAt,
        row.createdAt,
        row.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["executed_dives.csv"],
  },
  {
    file: "trip_sightings.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "dive_site_id",
      // The site's name as the crew saw it, snapshotted at the tap: a
      // shop that renames or deletes a reef still has a legible log.
      "dive_site_name",
      // A catalog slug rather than a name, for the reason
      // executed_dives.csv carries one: the words are DiveDay's copy in
      // the reader's language and a CSV has no reader to resolve them for.
      "species_slug",
      "count",
      "recorded_by_person_id",
      "recorded_at",
      "deleted_at",
      "updated_at",
    ],
    rows: ({ tripTitle, sightingRows }) =>
      sightingRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        row.diveSiteId,
        row.diveSiteName,
        row.speciesSlug,
        row.count,
        row.recordedByPersonId,
        row.recordedAt,
        row.deletedAt,
        row.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_sightings.csv"],
  },
  shopFile(BOOKING_ARRIVAL_EVENTS_CSV),
  shopFile(ROLL_CALL_EVENTS_CSV),
  {
    file: "roll_call_crew_events.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "person_id",
      "person_name",
      "status",
      "checkpoint",
      "source",
      "client_event_id",
      "recorded_by_person_id",
      "recorded_by_name",
      "note",
      "occurred_at",
      "created_at",
    ],
    rows: ({ personName, tripTitle, tripStartsAt, crewRollCallRows }) =>
      crewRollCallRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.personId,
        personName.get(row.personId),
        row.status,
        row.checkpoint,
        row.source,
        row.clientEventId,
        row.recordedByPersonId,
        personName.get(row.recordedByPersonId),
        row.note,
        row.occurredAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["roll_call_crew_events.csv"],
  },
  shopFile(BUDDY_PAIRS_CSV),
  {
    file: "waiver_templates.csv",
    header: ["id", "title", "version", "material_generation", "deleted_at", "created_at", "body"],
    rows: ({ templateRows }) =>
      templateRows.map((row) => [
        row.id,
        row.title,
        row.version,
        row.materialGeneration,
        row.deletedAt,
        row.createdAt,
        row.body,
      ]),
    note: EXPORT_FILE_NOTES["waiver_templates.csv"],
  },
  {
    file: "waiver_materiality_decisions.csv",
    header: [
      "id",
      "template_id",
      "template_title",
      "material",
      "actor_person_id",
      "actor_name",
      "decided_at",
      "seq",
    ],
    rows: ({ personName, templateRows, waiverMaterialityRows }) =>
      waiverMaterialityRows.map((row) => [
        row.id,
        row.templateId,
        templateRows.find((template) => template.id === row.templateId)?.title,
        row.material,
        row.actorPersonId,
        personName.get(row.actorPersonId),
        row.decidedAt,
        row.seq,
      ]),
    note: EXPORT_FILE_NOTES["waiver_materiality_decisions.csv"],
  },
  shopFile(WAIVER_RECORDS_CSV),
  {
    file: "course_forms.csv",
    header: ["id", "title", "current_version", "deleted_at", "created_at"],
    rows: ({ courseFormRows, courseFormVersionRows }) =>
      courseFormRows.map((row) => {
        const latest = courseFormVersionRows
          .filter((version) => version.formId === row.id)
          .reduce<(typeof courseFormVersionRows)[number] | undefined>(
            (newest, version) => (!newest || version.version > newest.version ? version : newest),
            undefined,
          );
        return [row.id, latest?.title, latest?.version, row.deletedAt, row.createdAt];
      }),
    note: EXPORT_FILE_NOTES["course_forms.csv"],
  },
  {
    file: "course_form_versions.csv",
    header: [
      "id",
      "form_id",
      "version",
      "title",
      "created_by_person_id",
      "created_by_name",
      "created_at",
      "body",
    ],
    rows: ({ personName, courseFormVersionRows }) =>
      courseFormVersionRows.map((row) => [
        row.id,
        row.formId,
        row.version,
        row.title,
        row.createdByPersonId,
        row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
        row.createdAt,
        row.body,
      ]),
    note: EXPORT_FILE_NOTES["course_form_versions.csv"],
  },
  {
    file: "course_form_requirements.csv",
    header: ["id", "course_id", "form_id", "position", "deleted_at", "created_at"],
    rows: ({ courseFormRequirementRows }) =>
      courseFormRequirementRows.map((row) => [
        row.id,
        row.courseId,
        row.formId,
        row.position,
        row.deletedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["course_form_requirements.csv"],
  },
  shopFile(COURSE_FORM_RECORDS_CSV),
  shopFile(RENTAL_FIT_CSV),
  {
    file: "gear_items.csv",
    header: [
      "id",
      "kind",
      "label",
      "size",
      "serial_number",
      "brand_model",
      "purchased_on",
      "status",
      "service_note",
      "aboard_boat_id",
      "deleted_at",
      "created_at",
      "updated_at",
    ],
    rows: ({ gearItemRows }) =>
      gearItemRows.map((row) => [
        row.id,
        row.kind,
        row.label,
        row.size,
        row.serialNumber,
        row.brandModel,
        row.purchasedOn,
        row.status,
        row.serviceNote,
        row.aboardBoatId,
        row.deletedAt,
        row.createdAt,
        row.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["gear_items.csv"],
  },
  {
    file: "gear_service_events.csv",
    header: [
      "id",
      "gear_item_id",
      "gear_item_label",
      "kind",
      "serviced_on",
      "next_due_on",
      "next_due_dives",
      "note",
      "recorded_by_person_id",
      "recorded_by_name",
      "created_at",
    ],
    rows: ({ personName, gearItemLabel, gearServiceEventRows }) =>
      gearServiceEventRows.map((row) => [
        row.id,
        row.gearItemId,
        gearItemLabel.get(row.gearItemId),
        row.kind,
        row.servicedOn,
        row.nextDueOn,
        row.nextDueDives,
        row.note,
        row.recordedByPersonId,
        row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["gear_service_events.csv"],
  },
  shopFile(GEAR_RESERVATIONS_CSV),
  shopFile(CUSTOMER_GEAR_ITEMS_CSV),
  shopFile(WORK_ORDERS_CSV),
  {
    file: "work_order_items.csv",
    header: ["id", "work_order_id", "customer_gear_item_id", "created_at"],
    rows: ({ workOrderItemRows }) =>
      workOrderItemRows.map((row) => [
        row.id,
        row.workOrderId,
        row.customerGearItemId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["work_order_items.csv"],
  },
  shopFile(WORK_ORDER_LINES_CSV),
  shopFile(WORK_ORDER_CARE_CSV),
  {
    file: "work_order_events.csv",
    header: [
      "id",
      "seq",
      "work_order_id",
      "kind",
      "from_status",
      "to_status",
      "technician_person_id",
      "technician_name",
      "actor_person_id",
      "actor_name",
      "created_at",
    ],
    rows: ({ personName, workOrderEventRows }) =>
      workOrderEventRows.map((row) => [
        row.id,
        row.seq,
        row.workOrderId,
        row.kind,
        row.fromStatus,
        row.toStatus,
        row.technicianPersonId,
        row.technicianPersonId ? personName.get(row.technicianPersonId) : null,
        row.actorPersonId,
        row.actorPersonId ? personName.get(row.actorPersonId) : null,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["work_order_events.csv"],
  },
  {
    file: "pre_departure_checklist_items.csv",
    header: ["id", "label", "sort_order", "deleted_at", "created_at", "updated_at"],
    rows: ({ checklistItemRows }) =>
      checklistItemRows.map((row) => [
        row.id,
        row.label,
        row.sortOrder,
        row.deletedAt,
        row.createdAt,
        row.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["pre_departure_checklist_items.csv"],
  },
  {
    file: "pre_departure_check_events.csv",
    header: [
      "id",
      "trip_id",
      "checklist_item_id",
      "checklist_item_label",
      "status",
      "source",
      "client_event_id",
      "note",
      "recorded_by_person_id",
      "recorded_by_name",
      "occurred_at",
      "created_at",
    ],
    rows: ({ personName, checklistItemLabel, checklistEventRows }) =>
      checklistEventRows.map((row) => [
        row.id,
        row.tripId,
        row.checklistItemId,
        checklistItemLabel.get(row.checklistItemId),
        row.status,
        row.source,
        row.clientEventId,
        row.note,
        row.recordedByPersonId,
        personName.get(row.recordedByPersonId),
        row.occurredAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["pre_departure_check_events.csv"],
  },
  shopFile(PRIOR_VISITS_CSV),
  shopFile(IMPORTED_PAYMENT_HISTORY_CSV),
  {
    file: "internal_notes.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "booking_id",
      "body",
      "created_by_person_id",
      "created_by_name",
      "created_at",
    ],
    rows: ({ personName, noteRows }) =>
      noteRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.bookingId,
        row.body,
        row.createdByPersonId,
        personName.get(row.createdByPersonId),
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["internal_notes.csv"],
  },
  {
    file: "activity_events.csv",
    header: [
      "id",
      "seq",
      "trip_id",
      "trip_title",
      "booking_id",
      "actor_person_id",
      "actor_name",
      "subject_person_id",
      "subject_name",
      "code",
      "params",
      "occurred_at",
    ],
    rows: ({ personName, tripTitle, activityRows }) =>
      activityRows.map((row) => [
        row.id,
        row.seq,
        row.tripId,
        row.tripId ? tripTitle.get(row.tripId) : null,
        row.bookingId,
        row.actorPersonId,
        personName.get(row.actorPersonId),
        row.subjectPersonId,
        row.subjectPersonId ? personName.get(row.subjectPersonId) : null,
        row.code,
        // The names the line's sentence needs, as JSON. Not a rendered
        // sentence: picking words is the reader's job and needs a locale
        // this layer deliberately does not have (`.claude/rules/domain.md`),
        // and a code plus its names is the more useful thing to hand a
        // spreadsheet anyway.
        JSON.stringify(row.params),
        row.occurredAt,
      ]),
    note: EXPORT_FILE_NOTES["activity_events.csv"],
  },
  shopFile(NOTIFICATION_DELIVERIES_CSV),
  shopFile(ORDERS_CSV),
  shopFile(ORDER_LINE_ITEMS_CSV),
  {
    file: "work_order_bills.csv",
    header: ["id", "work_order_id", "order_id", "created_by_person_id", "created_at"],
    rows: ({ workOrderBillRows }) =>
      workOrderBillRows.map((row) => [
        row.id,
        row.workOrderId,
        row.orderId,
        row.createdByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["work_order_bills.csv"],
  },
  {
    file: "customer_gear_reminder_settings.csv",
    header: [
      "id",
      "customer_gear_item_id",
      "reminders_off_at",
      "changed_by_person_id",
      "created_at",
      "updated_at",
    ],
    rows: ({ customerGearReminderSettingRows }) =>
      customerGearReminderSettingRows.map((row) => [
        row.id,
        row.customerGearItemId,
        row.remindersOffAt,
        row.changedByPersonId,
        row.createdAt,
        row.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["customer_gear_reminder_settings.csv"],
  },
  shopFile(TIPS_CSV),
  {
    file: "dive_sites.csv",
    header: [
      "id",
      "name",
      "location_name",
      "description",
      "difficulty_level",
      "depth_range",
      "max_depth_meters",
      "expected_bottom_time_minutes",
      "current_note",
      "dive_plan",
      "conservation_note",
      "fit_tone",
      "fit_note",
      "field_guide_tips_heading",
      "marine_life",
      "marine_life_description",
      "landmarks",
      "minimum_certification_level",
      "required_specialties",
      "requires_nitrox",
      "forecast_latitude",
      "forecast_longitude",
      "tide_station_id",
      // Whether the shop has said it meant that station even though it
      // sits further from the site than the editor's own threshold
      // (issue #1731). It travels with the id it answers: restored
      // without it, a genuinely remote site starts prompting again.
      "tide_station_confirmed",
      "tide_preference",
      "satellite_image_url",
      "route_image_url",
      "route_points",
      "route_label",
      "route_note",
      "route_zoom",
      "image_urls",
      // The shop's own staff-only note about running this site, and who
      // wrote it (issue #1204). It never reached a diver, and it travels
      // with the site for the same reason the drawn route does.
      "planning_note",
      "planning_note_at",
      "planning_note_by_person_id",
      "deleted_at",
      "created_at",
    ],
    rows: ({ siteRows }) =>
      siteRows.map((row) => [
        row.id,
        row.name,
        row.locationName,
        row.description,
        // The code, not the legacy free text beside it: `difficulty_level`
        // is what the app reads and what the shop chose (ADR
        // 20260813-dive-site-difficulty-is-a-code). The column keeps its
        // three stable values, so a destination system can map them.
        row.difficultyLevel,
        row.depthRange,
        row.maxDepthMeters,
        row.expectedBottomTimeMinutes,
        row.currentNote,
        row.divePlan,
        row.conservationNote,
        row.fitTone,
        row.fitNote,
        row.fieldGuideTipsHeading,
        row.marineLife,
        row.marineLifeDescription,
        JSON.stringify(row.landmarks),
        row.minimumCertificationLevel,
        row.requiredSpecialties.join("; "),
        row.requiresNitrox,
        row.forecastLatitude,
        row.forecastLongitude,
        row.tideStationId,
        row.tideStationConfirmed,
        row.tidePreference,
        row.satelliteImageUrl,
        row.routeImageUrl,
        // The drawn route travels with the site, and since issue #1771 a
        // shop that exports and re-imports really does keep the line it
        // drew (`src/db/dive-site-import.ts`). The four columns go together
        // or not at all: the waypoints are positions on a frame at a zoom,
        // so restoring them without the coordinates and zoom two columns
        // over draws a line over the wrong water, which is a briefing
        // saying something false rather than saying nothing. The importer
        // refuses the row on exactly that pairing.
        JSON.stringify(row.routePoints),
        row.routeLabel,
        row.routeNote,
        row.routeZoom,
        JSON.stringify(row.imageUrls),
        row.planningNote,
        row.planningNoteAt,
        row.planningNoteByPersonId,
        row.deletedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["dive_sites.csv"],
  },
  {
    file: "dive_site_creatures.csv",
    header: [
      "id",
      "dive_site_id",
      "dive_site_name",
      "position",
      "name",
      "kind",
      "description",
      "preparation_tip",
      "image_url",
      "catalog_slug",
    ],
    // A row stores a catalog slug and a position; the words are
    // DiveDay's and belong to no row (ADR
    // 20260813-marine-life-is-diveday-copy). They are resolved here in
    // the shop's own default language rather than left blank, because a
    // bundle of ninety-three slugs is not a thing a person can read, and
    // this file is what a shop opens in a spreadsheet. `catalog_slug` is
    // the column to reconcile against; the rest is a rendering.
    //
    // Iterated over the *rows* rather than over the resolved cards, so a
    // row DiveDay has no words for still appears with its id, its site
    // and its position. The briefing skips such a row; an export must
    // not. A shop's data-out bundle is the one place where "we dropped
    // something and said nothing" is the worst possible behaviour --
    // this file is what a shop reconciles against when it leaves.
    rows: ({ siteName, creatureRows, cardById }) =>
      creatureRows.map((row) => {
        const card = cardById.get(row.id);
        return [
          row.id,
          row.diveSiteId,
          siteName.get(row.diveSiteId),
          row.position,
          card?.name,
          card?.kind,
          card?.description,
          card?.preparationTip,
          card?.imageUrl,
          row.catalogSlug,
        ];
      }),
    note: EXPORT_FILE_NOTES["dive_site_creatures.csv"],
  },
  {
    file: "dive_site_moments.csv",
    header: [
      "id",
      "dive_site_id",
      "dive_site_name",
      "caption",
      "is_published",
      "image_url",
      "created_at",
    ],
    rows: ({ siteName, momentRows }) =>
      momentRows.map((row) => [
        row.id,
        row.diveSiteId,
        siteName.get(row.diveSiteId),
        row.caption,
        row.isPublished,
        row.imageUrl,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["dive_site_moments.csv"],
  },
  shopFile(RECAP_PHOTOS_CSV),
  {
    file: "trip_recap_photos.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "image_url",
      "uploaded_by_person_id",
      "uploaded_by_person_name",
      "created_at",
    ],
    rows: ({ tripRecapPhotoRows }) =>
      tripRecapPhotoRows.map(({ photo, tripTitle, uploadedByName }) => [
        photo.id,
        photo.tripId,
        tripTitle,
        photo.imageUrl,
        photo.uploadedByPersonId,
        uploadedByName,
        photo.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_recap_photos.csv"],
  },
  shopFile(TRIP_REVIEWS_CSV),
  {
    file: "recap_pulses.csv",
    header: [
      "id",
      "booking_id",
      "trip_id",
      "person_id",
      "diver_name",
      // Codes, not sentences — `recap_pulse_category`. The words are
      // DiveDay's copy in the reader's language, and a CSV has no reader
      // to resolve them for, so the slug is the durable fact. Same call
      // `observed_species_slug` makes.
      "categories",
      "note",
      "addressed_at",
      "addressed_by_person_id",
      "deleted_at",
      "created_at",
      "updated_at",
    ],
    rows: ({ recapPulseRows }) =>
      recapPulseRows.map(({ pulse, diverName }) => [
        pulse.id,
        pulse.bookingId,
        pulse.tripId,
        pulse.personId,
        diverName,
        JSON.stringify(pulse.categories),
        pulse.note,
        pulse.addressedAt,
        pulse.addressedByPersonId,
        pulse.deletedAt,
        pulse.createdAt,
        pulse.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["recap_pulses.csv"],
  },
  shopFile(REVIEW_MODERATION_EVENTS_CSV),
  {
    file: "dive_packages.csv",
    header: [
      "id",
      "name",
      "dive_count",
      "price_cents",
      "scope",
      "valid_until",
      "deleted_at",
      "created_by_person_id",
      "created_at",
    ],
    rows: ({ divePackageRows }) =>
      divePackageRows.map((row) => [
        row.id,
        row.name,
        row.diveCount,
        row.priceCents,
        row.scope,
        row.validUntil,
        row.deletedAt,
        row.createdByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["dive_packages.csv"],
  },
  shopFile(DIVE_PACKAGE_ENTITLEMENTS_CSV),
  {
    file: "shop_promo_codes.csv",
    header: [
      "id",
      "code",
      "description",
      "discount_percent",
      "discount_amount_cents",
      "scope",
      "status",
      "starts_at",
      "expires_at",
      "max_redemptions",
      "created_by_person_id",
      "created_at",
    ],
    rows: ({ promoCodeRows }) =>
      promoCodeRows.map((row) => [
        row.id,
        row.code,
        row.description,
        row.discountPercent,
        row.discountAmountCents,
        row.scope,
        row.status,
        row.startsAt,
        row.expiresAt,
        row.maxRedemptions,
        row.createdByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["shop_promo_codes.csv"],
  },
  {
    file: "shop_promo_redemptions.csv",
    header: ["id", "promo_code_id", "code", "checkout_id", "amount_charged_cents", "redeemed_at"],
    // The code travels beside its id for the same reason every other file
    // carries a `*_name` next to a `*_person_id`: a bundle a human opens
    // in a spreadsheet must be readable without joining it back together.
    rows: ({ promoCodeText, promoRedemptionRows }) =>
      promoRedemptionRows.map((row) => [
        row.id,
        row.promoCodeId,
        promoCodeText.get(row.promoCodeId),
        row.checkoutId,
        row.amountChargedCents,
        row.redeemedAt,
      ]),
    note: EXPORT_FILE_NOTES["shop_promo_redemptions.csv"],
  },
  {
    file: "courses.csv",
    header: [
      "id",
      "title",
      "agency",
      "slug",
      "description",
      "source_template_slug",
      "source_template_version",
      "source_template_snapshot",
      "summary",
      "overview",
      "price_cents",
      "e_learning_price_cents",
      "private_price_cents",
      "minimum_certification_level",
      "certifies_level",
      "minimum_age",
      "duration_text",
      "group_size_text",
      "prerequisite_note",
      "includes",
      "excludes",
      "schedule_days",
      "faqs",
      "learning_materials",
      "hero_image_url",
      "hero_image_alt",
      "gallery_photos",
      "is_active",
      "is_intro_course",
      "nitrox_compatible",
      "created_at",
    ],
    rows: ({ courseRows }) =>
      courseRows.map((row) => [
        row.id,
        row.title,
        row.agency,
        row.slug,
        row.description,
        row.sourceTemplateSlug,
        row.sourceTemplateVersion,
        JSON.stringify(row.sourceTemplateSnapshot),
        row.summary,
        row.overview,
        row.priceCents,
        row.eLearningPriceCents,
        row.privatePriceCents,
        row.minimumCertificationLevel,
        row.certifiesLevel,
        row.minimumAge,
        row.durationText,
        row.groupSizeText,
        row.prerequisiteNote,
        JSON.stringify(row.includes),
        JSON.stringify(row.excludes),
        JSON.stringify(row.scheduleDays),
        JSON.stringify(row.faqs),
        JSON.stringify(row.learningMaterials),
        row.heroImageUrl,
        row.heroImageAlt,
        JSON.stringify(row.galleryPhotos),
        row.isActive,
        row.isIntroCourse,
        row.nitroxCompatible,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["courses.csv"],
  },
  shopFile(COURSE_INQUIRIES_CSV),
];
