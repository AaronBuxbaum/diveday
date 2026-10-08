import { calendarDateInTimezone } from "@/lib/calendar-date";
import { EXPORT_FILE_NOTES } from "@/lib/export";
import { WEEKDAY_EXPORT_CODES, weekdaysIn } from "@/lib/recurrence";
import type { ShopExportContext } from "./export";
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
    header: ["id", "name", "capacity", "description", "created_at"],
    rows: ({ boatRows }) =>
      boatRows.map((row) => [row.id, row.name, row.capacity, row.description, row.createdAt]),
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
  {
    file: "certifications.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "agency",
      "level",
      "identifier",
      // The number the *diver* typed, which is never the number above: one
      // is a claim and one is what the shop holds, and a file that
      // merged them would launder the first into the second on the way
      // back in (issue #630).
      "declared_identifier",
      "status",
      "review_note",
      "reviewed_at",
      "reviewed_by_person_id",
      // Set when the review was the agency's own page, read through the
      // DiveDay browser extension (H-105); review_note then holds its words.
      "agency_checked_at",
      // Provenance from the contact importer (ADR 20260724-import-verified-cards):
      // a non-null imported_at is the definitive "this card was migrated, not
      // carded on sight" marker, permanent even after a staff confirm.
      "imported_at",
      "imported_from_label",
      // The weaker sibling of imported_at, and it travels for the same
      // reason: a non-null self_declared_at means the level came off a
      // public opt-in the diver filled in themselves, with no card
      // sighted. Dropping it from the export would launder a claim into
      // an ordinary card the moment the file is read back.
      "self_declared_at",
      // A third provenance, alongside imported_at and self_declared_at
      // above: a non-null issued_by_shop_at means this shop's own
      // instructor certified the diver from a course session's roster
      // (issue #717), never a captured or self-declared card.
      // issued_from_trip_id names that session; issued_by_person_id
      // names the instructor. Same reasoning as the other two
      // provenance stamps — dropping any of the three from the export
      // would launder one kind of card into another on the way back in.
      "issued_by_shop_at",
      "issued_from_trip_id",
      "issued_by_person_id",
      "deleted_at",
      "deleted_by_person_id",
      "created_at",
    ],
    rows: ({ personName, certificationRows }) =>
      certificationRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.agency,
        row.level,
        row.identifier,
        row.declaredIdentifier,
        row.status,
        row.reviewNote,
        row.reviewedAt,
        row.reviewedByPersonId,
        row.agencyCheckedAt,
        row.importedAt,
        row.importedFromLabel,
        row.selfDeclaredAt,
        row.issuedByShopAt,
        row.issuedFromTripId,
        row.issuedByPersonId,
        row.deletedAt,
        row.deletedByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["certifications.csv"],
  },
  {
    file: "specialty_certifications.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "agency",
      "specialty",
      "identifier",
      "status",
      "review_note",
      "reviewed_at",
      "reviewed_by_person_id",
      "deleted_at",
      "deleted_by_person_id",
      "created_at",
    ],
    rows: ({ personName, specialtyRows }) =>
      specialtyRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.agency,
        row.specialty,
        row.identifier,
        row.status,
        row.reviewNote,
        row.reviewedAt,
        row.reviewedByPersonId,
        row.deletedAt,
        row.deletedByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["specialty_certifications.csv"],
  },
  {
    file: "nitrox_certifications.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "agency",
      "identifier",
      "status",
      "review_note",
      "reviewed_at",
      "reviewed_by_person_id",
      "imported_at",
      "imported_from_label",
      // Same reason as the level card's — see certifications.csv above.
      "self_declared_at",
      "deleted_at",
      "deleted_by_person_id",
      "created_at",
    ],
    rows: ({ personName, nitroxRows }) =>
      nitroxRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.agency,
        row.identifier,
        row.status,
        row.reviewNote,
        row.reviewedAt,
        row.reviewedByPersonId,
        row.importedAt,
        row.importedFromLabel,
        row.selfDeclaredAt,
        row.deletedAt,
        row.deletedByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["nitrox_certifications.csv"],
  },
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
  {
    file: "bookings.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "person_id",
      "person_name",
      "status",
      // Diver, snorkeler or rider (ADR 20261007-participant-types): what
      // this seat was for, and which gates it was asked to clear; and
      // what it was sold as, which differs when staff changed it.
      "participant_type",
      "booked_as",
      "wants_nitrox",
      "conditions_briefed_at",
      // What the diver said this dive was for, and the one support they
      // asked for when they said they were easing back (ADR
      // 20260904-reef-all-the-way-down). Codes rather than words: an
      // export is the shop's own database handed back, and the sentence a
      // diver read was in whichever language they read it in.
      "dive_intent",
      "re_entry_ask",
      // The diver's own answer to "when did you last dive?" (ADR
      // 20260821-currency-is-what-catches-people). A statement they made
      // about themselves, on the seat they made it for — the same kind of
      // record as `dive_intent` beside it, and a shop moving its data
      // elsewhere should not have to ask every returning diver again.
      "last_dived_band",
      // The party structure a shop booked (ADR 20260804-seat-claim-links).
      // Both are real records of what happened to a seat, so both travel:
      // `party_lead_booking_id` is a booking id from this same file's `id`
      // column, and `claimed_at` sits alongside `conditions_briefed_at` as
      // another plain fact about the seat. Dropping either would let a shop
      // export a party of six and get back six unrelated singles.
      "party_lead_booking_id",
      "claimed_at",
      // Which partner's link brought this diver (issue #1285). A plain
      // fact about the seat, like `claimed_at` above it — a shop that
      // exported its bookings and got them back un-credited would have
      // silently lost every partner's attribution.
      //
      // Kept here although no *page* renders it any more (issue #1294):
      // an export is the shop's own database handed back under the
      // strictest gate in the product, and its contract is completeness.
      // That is a different question from a staff surface presenting a
      // stranger's text as a business fact. Hostile text cannot escape a
      // CSV cell either — `csvCell`'s formula guard covers the one
      // reachable shape, a leading `-`.
      "referral_source",
      // **Which diver's link brought this one** (the buddy seat, ADR
      // 20260908-one-hand, decision 6, lever W). A plain fact about the
      // seat, in exactly the class `party_lead_booking_id` and
      // `referral_source` above are in, so it travels with it rather
      // than in a file of its own.
      "referred_by_booking_id",
      // The diver's own consent to have the crew told this is a first
      // trip, or a return after a long gap (issue #1182). A statement
      // they made about themselves on this seat, the same kind of record
      // as `last_dived_band` above — and a shop that moved its data would
      // otherwise be asking every one of them again.
      "welcome_shared_at",
      // The diver answering "nothing has changed" about the sizes, gas
      // and emergency contact the shop already holds (ADR
      // 20260904-reef-all-the-way-down, D15). Same class as the two
      // columns above: a statement they made about themselves on this
      // seat, and a shop that moved its data would otherwise ask the
      // whole board the question over again.
      "carried_facts_confirmed_at",
      // The instructor's own words to this student, and who wrote them
      // (issues #1196, #1205). The student read it on their recap; a
      // shop moving its data takes the sentence with it.
      "course_next_step",
      "course_next_step_at",
      "course_next_step_by_person_id",
      // The tick that this student finished the course's learning
      // materials, and who ticked it (ADR 20261008-course-learning-materials).
      "course_materials_done_at",
      "course_materials_done_by_person_id",
      "hotel_pickup_location",
      "pickup_time",
      "payment_status",
      "payment_amount_cents",
      "payment_currency",
      "payment_provider",
      "created_at",
    ],
    rows: ({
      personName,
      tripTitle,
      tripStartsAt,
      bookingRows,
      paymentByBooking,
      buddyReferralByBooking,
    }) =>
      bookingRows.map((row) => {
        const payment = paymentByBooking.get(row.id);
        return [
          row.id,
          row.tripId,
          tripTitle.get(row.tripId),
          tripStartsAt.get(row.tripId),
          row.personId,
          personName.get(row.personId),
          row.status,
          row.participantType,
          row.bookedAs,
          row.wantsNitrox,
          row.conditionsBriefedAt,
          row.diveIntent,
          row.reEntryAsk,
          row.lastDivedBand,
          row.partyLeadBookingId,
          row.claimedAt,
          row.referralSource,
          buddyReferralByBooking.get(row.id),
          row.welcomeSharedAt,
          row.carriedFactsConfirmedAt,
          row.courseNextStep,
          row.courseNextStepAt,
          row.courseNextStepByPersonId,
          row.courseMaterialsDoneAt,
          row.courseMaterialsDoneByPersonId,
          row.hotelPickupLocation,
          row.pickupTime,
          payment?.status ?? "unpaid",
          payment?.amountCents,
          payment?.currency,
          payment?.provider,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["bookings.csv"],
  },
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
  {
    file: "waitlist_entries.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "person_id",
      "person_name",
      "invited_at",
      "created_at",
    ],
    rows: ({ personName, waitlistRows, tripTitle, tripStartsAt }) =>
      waitlistRows.map((row) => [
        row.id,
        row.tripId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.personId,
        personName.get(row.personId),
        row.invitedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["waitlist_entries.csv"],
  },
  {
    file: "trip_invitations.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "source",
      "course_inquiry_id",
      "person_id",
      "person_name",
      "created_by_person_id",
      "created_by_name",
      "invited_at",
      "created_at",
    ],
    rows: ({ personName, tripTitle, tripStartsAt, inquiryById, invitationRows }) =>
      invitationRows.map((row) => {
        const inquiry = row.courseInquiryId ? inquiryById.get(row.courseInquiryId) : undefined;
        const personId = row.personId ?? inquiry?.personId ?? null;
        return [
          row.id,
          row.tripId,
          tripTitle.get(row.tripId),
          tripStartsAt.get(row.tripId),
          row.source,
          row.courseInquiryId,
          personId,
          personId ? personName.get(personId) : inquiry?.name,
          row.createdByPersonId,
          personName.get(row.createdByPersonId),
          row.invitedAt,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["trip_invitations.csv"],
  },
  {
    file: "last_minute_list.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "available_from",
      "available_until",
      "unsubscribed_at",
      "created_at",
    ],
    rows: ({ personName, lastMinuteListRows }) =>
      lastMinuteListRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.availableFrom,
        row.availableUntil,
        row.unsubscribedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["last_minute_list.csv"],
  },
  {
    file: "trip_last_minute_promos.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "status",
      "discount_percent",
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
        row.code,
        row.expiresAt,
        row.recipientCount,
        row.createdByPersonId,
        row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_last_minute_promos.csv"],
  },
  {
    file: "trip_last_minute_promo_recipients.csv",
    header: ["id", "trip_promo_id", "person_id", "person_name", "email", "created_at"],
    rows: ({ personName, lastMinutePromoRecipientRows }) =>
      lastMinutePromoRecipientRows.map((row) => [
        row.id,
        row.tripPromoId,
        row.personId,
        personName.get(row.personId),
        row.email,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_last_minute_promo_recipients.csv"],
  },
  {
    file: "booking_payment_events.csv",
    header: [
      "id",
      "booking_id",
      "person_id",
      "person_name",
      "status",
      "previous_status",
      "amount_cents",
      "currency",
      "provider",
      "provider_ref",
      "operation",
      "note",
      "occurred_at",
    ],
    rows: ({ personName, bookingPerson, paymentEventRows }) =>
      paymentEventRows.map((row) => {
        const personId = bookingPerson.get(row.bookingId);
        return [
          row.id,
          row.bookingId,
          personId,
          personId ? personName.get(personId) : null,
          row.status,
          row.previousStatus,
          row.amountCents,
          row.currency,
          row.provider,
          row.providerRef,
          row.operation,
          row.note,
          row.occurredAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["booking_payment_events.csv"],
  },
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
      "currency",
      "amount_per_diver_cents",
      "total_cents",
      "pass_through_cents",
      "tax_enabled",
      "tax_cents",
      "settled_total_cents",
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
        row.currency,
        row.amountPerDiverCents,
        row.totalCents,
        row.passThroughCents,
        row.taxEnabled,
        row.taxCents,
        row.settledTotalCents,
        row.isDeposit,
        row.abandonedRecoverySentAt,
        row.expiresAt,
        row.completedAt,
        row.asyncPaymentFailedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["booking_checkouts.csv"],
  },
  {
    file: "booking_checkout_bookings.csv",
    header: [
      "checkout_id",
      "booking_id",
      "person_id",
      "person_name",
      "trip_cents",
      "gear_cents",
      "pass_through_cents",
      "tax_cents",
    ],
    rows: ({ personName, bookingPerson, checkoutBookingRows }) =>
      checkoutBookingRows.map((row) => {
        const personId = bookingPerson.get(row.bookingId) ?? null;
        return [
          row.checkoutId,
          row.bookingId,
          personId,
          personId ? personName.get(personId) : null,
          row.tripCents,
          row.gearCents,
          row.passThroughCents,
          row.taxCents,
        ];
      }),
    note: EXPORT_FILE_NOTES["booking_checkout_bookings.csv"],
  },
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
  {
    file: "booking_arrival_events.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "booking_id",
      "person_id",
      "person_name",
      "status",
      "source",
      "client_event_id",
      "offline_snapshot_saved_at",
      "recorded_by_person_id",
      "recorded_by_name",
      "occurred_at",
      "created_at",
    ],
    rows: ({ personName, tripTitle, tripStartsAt, bookingPerson, arrivalRows }) =>
      arrivalRows.map((row) => {
        const personId = bookingPerson.get(row.bookingId);
        return [
          row.id,
          row.tripId,
          tripTitle.get(row.tripId),
          tripStartsAt.get(row.tripId),
          row.bookingId,
          personId,
          personId ? personName.get(personId) : null,
          row.status,
          row.source,
          row.clientEventId,
          row.offlineSnapshotSavedAt,
          row.recordedByPersonId,
          personName.get(row.recordedByPersonId),
          row.occurredAt,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["booking_arrival_events.csv"],
  },
  {
    file: "roll_call_events.csv",
    header: [
      "id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "booking_id",
      "person_id",
      "person_name",
      "status",
      "checkpoint",
      "source",
      "client_event_id",
      "offline_snapshot_saved_at",
      "recorded_by_person_id",
      "recorded_by_name",
      "note",
      "occurred_at",
      "created_at",
    ],
    rows: ({ personName, tripTitle, tripStartsAt, bookingPerson, rollCallRows }) =>
      rollCallRows.map((row) => {
        const personId = bookingPerson.get(row.bookingId);
        return [
          row.id,
          row.tripId,
          tripTitle.get(row.tripId),
          tripStartsAt.get(row.tripId),
          row.bookingId,
          personId,
          personId ? personName.get(personId) : null,
          row.status,
          row.checkpoint,
          row.source,
          row.clientEventId,
          row.offlineSnapshotSavedAt,
          row.recordedByPersonId,
          personName.get(row.recordedByPersonId),
          row.note,
          row.occurredAt,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["roll_call_events.csv"],
  },
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
  {
    file: "buddy_pairs.csv",
    header: [
      "pair_id",
      "trip_id",
      "trip_title",
      "trip_starts_at",
      "member_kind",
      "booking_id",
      "crew_person_id",
      "person_id",
      "person_name",
      "paired_by_person_id",
      "paired_by_name",
      "created_at",
    ],
    // One row per member, diver or crew (ADR 20260804-buddy-teams).
    // `person_id` resolves to the same thing either way — the human — so a
    // reader who only cares "who was on this team" reads one column;
    // `member_kind` is what tells them whether that human held a seat.
    rows: ({ personName, tripTitle, tripStartsAt, bookingPerson, buddyPairRows }) =>
      buddyPairRows.map((row) => {
        const personId = row.bookingId
          ? (bookingPerson.get(row.bookingId) ?? null)
          : row.crewPersonId;
        return [
          row.pairId,
          row.tripId,
          tripTitle.get(row.tripId),
          tripStartsAt.get(row.tripId),
          row.bookingId ? "diver" : "crew",
          row.bookingId,
          row.crewPersonId,
          personId,
          personId ? personName.get(personId) : null,
          row.pairedByPersonId,
          personName.get(row.pairedByPersonId),
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["buddy_pairs.csv"],
  },
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
  {
    file: "waiver_records.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "booking_id",
      "template_id",
      "template_title",
      "template_version",
      "template_generation",
      "status",
      "signed_name",
      "signature_method",
      "recorded_by_person_id",
      "recorded_by_name",
      "started_at",
      "consented_at",
      "signed_at",
      "completed_at",
      "medical_review_required",
      "medical_answers",
      // The physician clearance that ends a medical hold (issue #1252).
      // Its *document* is deliberately not here — see EXCLUDED_COLUMNS in
      // src/db/export.test.ts — but the fact and its accountable staff
      // member are the shop's own evidence, and a restore that lost them
      // would re-block every cleared diver with no record of who cleared
      // them or when the physician evaluated them.
      "medical_cleared_at",
      "medical_cleared_by_person_id",
      "medical_cleared_by_name",
      // The same act with the opposite answer (issue #1283), exported for
      // the same reason and with more force: a refusal is the record of
      // why a diver stayed ashore, and a restore that lost it would show
      // the destination a diver still "awaiting" an answer that arrived
      // months ago. Its document is excluded exactly as the clearance's
      // is; the fact and its accountable staff member are the shop's own.
      "medical_clearance_declined_at",
      "medical_clearance_declined_by_person_id",
      "medical_clearance_declined_by_name",
      "medical_clearance_evaluated_on",
      "medical_clearance_physician_name",
      // The guardian's half of a minor's release (ADR
      // 20260907-guardian-co-signature): who co-signed, as what, how,
      // and when. Inside the seal, so a destination that re-verified the
      // hash without them would read every minor's release as tampered.
      "guardian_name",
      "guardian_relationship",
      "guardian_email",
      "guardian_signature_method",
      "guardian_consented_at",
      "guardian_signed_at",
      "integrity_hash",
      "integrity_version",
      "superseded_at",
      "expires_at",
      "imported_from_label",
      "import_source_document_url",
      "import_source_medical_document_url",
      // Which seal the row's `integrity_hash` is over: version 2 means
      // this release was stripped when its diver was erased, and the
      // signature and medical answers above are blank by decision rather
      // than by omission (ADR 20260802-diver-data-erasure).
      "anonymized_at",
      "anonymized_by_person_id",
      // Version 3: the release followed its seat to a new diver record
      // (issue #2080). Inside the seal with `person_id`.
      "moved_from_person_id",
      "moved_at",
      "moved_by_person_id",
      // Version 4: the guardian asked for their address to be erased and
      // the shop did (H-103, issue #1673). Inside the seal, so a
      // destination re-verifying it needs both.
      "guardian_email_erased_at",
      "guardian_email_erased_by_person_id",
      "created_at",
    ],
    rows: ({ personName, waiverRows }) =>
      waiverRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.bookingId,
        row.templateId,
        row.templateTitle,
        row.templateVersion,
        row.templateGeneration,
        row.status,
        row.signedName,
        row.signatureMethod,
        row.recordedByPersonId,
        row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
        row.startedAt,
        row.consentedAt,
        row.signedAt,
        row.completedAt,
        row.medicalReviewRequired,
        row.medicalAnswers ? JSON.stringify(row.medicalAnswers) : null,
        row.medicalClearedAt,
        row.medicalClearedByPersonId,
        row.medicalClearedByPersonId ? personName.get(row.medicalClearedByPersonId) : null,
        row.medicalClearanceDeclinedAt,
        row.medicalClearanceDeclinedByPersonId,
        row.medicalClearanceDeclinedByPersonId
          ? personName.get(row.medicalClearanceDeclinedByPersonId)
          : null,
        row.medicalClearanceEvaluatedOn,
        row.medicalClearancePhysicianName,
        row.guardianName,
        row.guardianRelationship,
        row.guardianEmail,
        row.guardianSignatureMethod,
        row.guardianConsentedAt,
        row.guardianSignedAt,
        row.integrityHash,
        row.integrityVersion,
        row.supersededAt,
        row.expiresAt,
        row.importedFromLabel,
        row.importSourceDocumentUrl,
        row.importSourceMedicalDocumentUrl,
        row.anonymizedAt,
        row.anonymizedByPersonId,
        row.movedFromPersonId,
        row.movedAt,
        row.movedByPersonId,
        row.guardianEmailErasedAt,
        row.guardianEmailErasedByPersonId,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["waiver_records.csv"],
  },
  {
    file: "rental_fit.csv",
    header: [
      "person_id",
      "person_name",
      "rents_bcd",
      "rents_regulator",
      "rents_wetsuit",
      "rents_mask_fins",
      "rents_weights",
      "rents_dive_computer",
      "rents_gopro",
      "rents_drysuit",
      "rents_hood",
      "rents_gloves",
      "rents_torch",
      "rents_smb",
      "bcd_size",
      "wetsuit_size",
      "drysuit_size",
      "hood_size",
      "glove_size",
      "boot_size",
      "fin_size",
      "weight_preference",
      "dives_dry",
      "note",
      "needs_staff_fit_at",
      "needs_staff_fit_note",
      // Who raised the flag, by the same id + name pair every other
      // person reference in the bundle uses. A safety flag without its
      // attribution is a rumour.
      "needs_staff_fit_by",
      "needs_staff_fit_by_name",
      // A staffer keeping the size a unit actually came back in (issue
      // #1174). Carried for the same reason the flag above it is, and
      // with the same id + name pair: the diver's own thread reads this
      // back as "Keiko kept your BCD at M", so a bundle without the
      // attribution would restore a sentence with nobody in it. The
      // item says which piece, which is what stops the sentence naming
      // the wrong one.
      "fit_confirmed_at",
      "fit_confirmed_by",
      "fit_confirmed_by_name",
      "fit_confirmed_item",
      "updated_at",
    ],
    rows: ({ personName, rentalFitRows }) =>
      rentalFitRows.map((row) => [
        row.personId,
        personName.get(row.personId),
        row.rentsBcd,
        row.rentsRegulator,
        row.rentsWetsuit,
        row.rentsMaskFins,
        row.rentsWeights,
        row.rentsDiveComputer,
        row.rentsGopro,
        row.rentsDrysuit,
        row.rentsHood,
        row.rentsGloves,
        row.rentsTorch,
        row.rentsSmb,
        row.bcdSize,
        row.wetsuitSize,
        row.drysuitSize,
        row.hoodSize,
        row.gloveSize,
        row.bootSize,
        row.finSize,
        row.weightPreference,
        row.divesDry,
        row.note,
        row.needsStaffFitAt,
        row.needsStaffFitNote,
        row.needsStaffFitBy,
        row.needsStaffFitBy ? personName.get(row.needsStaffFitBy) : null,
        row.fitConfirmedAt,
        row.fitConfirmedBy,
        row.fitConfirmedBy ? personName.get(row.fitConfirmedBy) : null,
        row.fitConfirmedItem,
        row.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["rental_fit.csv"],
  },
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
  {
    file: "gear_reservations.csv",
    header: [
      "id",
      "gear_item_id",
      "gear_item_label",
      "booking_id",
      "person_id",
      "person_name",
      "reserved_from",
      "reserved_until",
      "checked_out_at",
      "returned_at",
      "return_outcome",
      "return_note",
      "dives_logged",
      "created_at",
    ],
    rows: ({ personName, bookingPerson, gearItemLabel, gearReservationRows }) =>
      gearReservationRows.map((row) => {
        const holderPersonId =
          row.personId ?? (row.bookingId ? (bookingPerson.get(row.bookingId) ?? null) : null);
        return [
          row.id,
          row.gearItemId,
          gearItemLabel.get(row.gearItemId),
          row.bookingId,
          row.personId,
          holderPersonId ? personName.get(holderPersonId) : null,
          row.reservedFrom,
          row.reservedUntil,
          row.checkedOutAt,
          row.returnedAt,
          row.returnOutcome,
          row.returnNote,
          row.divesLogged,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["gear_reservations.csv"],
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
  {
    // History the shop brought in from its previous system
    // (ADR 20260725-import-prior-visits). In the bundle because a shop's
    // own history is its own to take back out, and out of the operational
    // files because that is exactly what it never was.
    file: "prior_visits.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "visited_on",
      "title",
      "status_label",
      "amount_label",
      "source_label",
      "source_reference",
      "imported_at",
    ],
    rows: ({ personName, priorVisitRows }) =>
      priorVisitRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.visitedOn,
        row.title,
        row.statusLabel,
        row.amountLabel,
        row.sourceLabel,
        row.sourceReference,
        row.importedAt,
      ]),
    note: EXPORT_FILE_NOTES["prior_visits.csv"],
  },
  {
    // Separate source evidence, deliberately not folded into orders.csv:
    // an old processor's receipt or Stripe reference is not a DiveDay
    // invoice. The export keeps the source row portable without making
    // the next system mistake it for a live payment.
    file: "imported_payment_history.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "occurred_on",
      "direction",
      "title",
      "status_label",
      "amount_label",
      "amount_cents",
      "currency",
      "payment_reference",
      "receipt_reference",
      "receipt_document_url",
      "source_label",
      "source_reference",
      "stripe_reference",
      "imported_at",
    ],
    rows: ({ personName, importedPaymentHistoryRows }) =>
      importedPaymentHistoryRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.occurredOn,
        row.direction,
        row.title,
        row.statusLabel,
        row.amountLabel,
        row.amountCents,
        row.currency,
        row.paymentReference,
        row.receiptReference,
        row.receiptDocumentUrl,
        row.sourceLabel,
        row.sourceReference,
        row.stripeReference,
        row.importedAt,
      ]),
    note: EXPORT_FILE_NOTES["imported_payment_history.csv"],
  },
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
  {
    file: "notification_deliveries.csv",
    header: [
      "id",
      "booking_id",
      "person_id",
      "person_name",
      "kind",
      "status",
      "provider_message_id",
      "provider_status",
      "provider_status_at",
      "provider_detail",
      "send_http_status",
      "send_error_code",
      "send_error",
      "attempted_at",
      "created_at",
    ],
    rows: ({ personName, bookingPerson, notificationRows }) =>
      notificationRows.map((row) => {
        const personId = bookingPerson.get(row.bookingId) ?? null;
        return [
          row.id,
          row.bookingId,
          personId,
          personId ? personName.get(personId) : null,
          row.kind,
          row.status,
          row.providerMessageId,
          row.providerStatus,
          row.providerStatusAt,
          row.providerDetail,
          row.sendHttpStatus,
          row.sendErrorCode,
          row.sendError,
          row.attemptedAt,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["notification_deliveries.csv"],
  },
  {
    file: "orders.csv",
    header: [
      "id",
      "person_id",
      "person_name",
      "booking_id",
      "created_by_person_id",
      "created_by_name",
      "status",
      "currency",
      "total_cents",
      "pass_through_cents",
      "tax_cents",
      "amount_paid_cents",
      "refunded_cents",
      "description",
      "stripe_invoice_id",
      "hosted_invoice_url",
      "invoice_pdf_url",
      "finalized_at",
      "paid_at",
      "voided_at",
      "refunded_at",
      "created_at",
    ],
    rows: ({ personName, orderRows }) =>
      orderRows.map((row) => [
        row.id,
        row.personId,
        personName.get(row.personId),
        row.bookingId,
        row.createdByPersonId,
        personName.get(row.createdByPersonId),
        row.status,
        row.currency,
        row.totalCents,
        row.passThroughCents,
        row.taxCents,
        row.amountPaidCents,
        row.refundedCents,
        row.description,
        row.stripeInvoiceId,
        row.hostedInvoiceUrl,
        row.invoicePdfUrl,
        row.finalizedAt,
        row.paidAt,
        row.voidedAt,
        row.refundedAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["orders.csv"],
  },
  {
    file: "order_line_items.csv",
    header: ["order_id", "kind", "description", "quantity", "unit_amount_cents", "created_at"],
    rows: ({ orderLineRows }) =>
      orderLineRows.map((row) => [
        row.orderId,
        row.kind,
        row.description,
        row.quantity,
        row.unitAmountCents,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["order_line_items.csv"],
  },
  {
    file: "tips.csv",
    header: [
      "id",
      "booking_id",
      "person_id",
      "person_name",
      "status",
      "currency",
      "amount_cents",
      "stripe_session_id",
      "expires_at",
      "completed_at",
      "created_at",
    ],
    rows: ({ personName, bookingPerson, tipRows }) =>
      tipRows.map((row) => {
        const personId = bookingPerson.get(row.bookingId) ?? null;
        return [
          row.id,
          row.bookingId,
          personId,
          personId ? personName.get(personId) : null,
          row.status,
          row.currency,
          row.amountCents,
          row.stripeSessionId,
          row.expiresAt,
          row.completedAt,
          row.createdAt,
        ];
      }),
    note: EXPORT_FILE_NOTES["tips.csv"],
  },
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
  {
    file: "recap_photos.csv",
    header: ["id", "booking_id", "trip_id", "image_url", "caption", "created_at"],
    rows: ({ recapPhotoRows }) =>
      recapPhotoRows.map((row) => [
        row.id,
        row.bookingId,
        row.tripId,
        row.imageUrl,
        row.caption,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["recap_photos.csv"],
  },
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
  {
    file: "trip_reviews.csv",
    header: [
      "id",
      "booking_id",
      "trip_id",
      "person_id",
      "diver_name",
      "rating",
      "comment",
      "is_standout",
      "is_published",
      "published_at",
      "created_at",
      "updated_at",
    ],
    rows: ({ reviewRows }) =>
      reviewRows.map(({ review, diverName }) => [
        review.id,
        review.bookingId,
        review.tripId,
        review.personId,
        diverName,
        review.rating,
        review.comment,
        review.isStandout,
        review.isPublished,
        review.publishedAt,
        review.createdAt,
        review.updatedAt,
      ]),
    note: EXPORT_FILE_NOTES["trip_reviews.csv"],
  },
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
  {
    file: "review_moderation_events.csv",
    header: [
      "id",
      "review_id",
      "action",
      "reason",
      "reason_note",
      "recorded_by_person_id",
      "recorded_by_name",
      "occurred_at",
    ],
    rows: ({ reviewModerationRows }) =>
      reviewModerationRows.map(({ event, staffName }) => [
        event.id,
        event.reviewId,
        event.action,
        event.reason,
        event.reasonNote,
        event.recordedByPersonId,
        staffName,
        event.occurredAt,
      ]),
    note: EXPORT_FILE_NOTES["review_moderation_events.csv"],
  },
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
  {
    file: "dive_package_entitlements.csv",
    header: [
      "id",
      "package_id",
      "person_id",
      "order_id",
      "booking_id",
      "consumed_at",
      "expires_at",
      "created_at",
    ],
    rows: ({ entitlementRows }) =>
      entitlementRows.map((row) => [
        row.id,
        row.packageId,
        row.personId,
        row.orderId,
        row.bookingId,
        row.consumedAt,
        row.expiresAt,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["dive_package_entitlements.csv"],
  },
  {
    file: "shop_promo_codes.csv",
    header: [
      "id",
      "code",
      "description",
      "discount_percent",
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
  {
    file: "course_inquiries.csv",
    header: [
      "id",
      "course_id",
      "course_title",
      "interest",
      "person_id",
      "person_name",
      "name",
      "email",
      "phone",
      "experience_level",
      "timing",
      "preferred_date",
      "alternate_date",
      "date_flexible",
      "divers",
      "message",
      "created_at",
    ],
    rows: ({ personName, courseTitle, inquiryRows }) =>
      inquiryRows.map((row) => [
        row.id,
        row.courseId,
        // Null for a request that names no course — it says what it is
        // about in `interest` instead, the column beside this one.
        row.courseId ? courseTitle.get(row.courseId) : null,
        row.interest,
        row.personId,
        // Resolved at capture time by exact email match against a live
        // diver, never back-filled — so a null here is a lead nobody could
        // tie to a person, not a lookup this export skipped.
        row.personId ? personName.get(row.personId) : null,
        row.name,
        row.email,
        row.phone,
        row.experienceLevel,
        row.timing,
        row.preferredDate,
        row.alternateDate,
        row.dateFlexible,
        row.divers,
        row.message,
        row.createdAt,
      ]),
    note: EXPORT_FILE_NOTES["course_inquiries.csv"],
  },
];
