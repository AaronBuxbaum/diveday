import { strToU8, zipSync } from "fflate";
import type {
  Booking,
  BookingPayment,
  Certification,
  Course,
  DiveSite,
  NitroxCertification,
  Order,
  OrderLineItem,
  Person,
  RentalFitProfile,
  RollCallEvent,
  Shop,
  SpecialtyCertification,
  Trip,
  TripDive,
  TripRequirement,
  TripSeries,
  TripWaitlistEntry,
  WaiverRecord,
  WaiverTemplate,
} from "@/db/schema";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";

/**
 * The full-shop data export — the "leave anytime" guarantee from the
 * portability wedge (docs/product/competitive-strategy.md). Everything a shop
 * owns leaves as documented CSVs in one ZIP, with a README that is generated
 * from the same dataset definitions the CSVs are, so the documentation can
 * never drift from the data.
 *
 * Secrets never leave: waiver link token hashes and login password hashes are
 * excluded by construction — no dataset column reads them — and the tests
 * assert their absence from the whole bundle.
 */

/** Everything the export reads, loaded shop-scoped by src/db/export.ts. */
export type ShopExportData = {
  shop: Shop;
  people: (Person & { roles: Role[] })[];
  certifications: Certification[];
  specialtyCertifications: SpecialtyCertification[];
  nitroxCertifications: NitroxCertification[];
  waiverTemplates: WaiverTemplate[];
  waiverRecords: WaiverRecord[];
  trips: Trip[];
  tripDives: TripDive[];
  tripRequirements: TripRequirement[];
  tripSeries: TripSeries[];
  tripAssignments: { tripId: string; personId: string }[];
  bookings: Booking[];
  waitlistEntries: TripWaitlistEntry[];
  bookingPayments: BookingPayment[];
  orders: Order[];
  orderLineItems: OrderLineItem[];
  rollCallEvents: RollCallEvent[];
  rentalFitProfiles: RentalFitProfile[];
  diveSites: DiveSite[];
  courses: Course[];
};

type CsvCell = string | number | boolean | Date | null | undefined | object;

/** ISO 8601 for instants, JSON for structured cells, empty string for null. */
function formatCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

function escapeCell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * RFC 4180 CSV: CRLF rows, quoted-and-doubled special cells, and a UTF-8 BOM
 * so Excel opens accented diver names correctly without an import wizard.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => escapeCell(formatCell(cell))).join(","),
  );
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

type Column<Row> = {
  header: string;
  description: string;
  value: (row: Row) => CsvCell;
};

type Dataset = {
  filename: string;
  description: string;
  columnDocs: { header: string; description: string }[];
  toCsv: (data: ShopExportData) => string;
  rowCount: (data: ShopExportData) => number;
};

/** Erases the row type so heterogeneous datasets can live in one ordered list. */
function dataset<Row>(definition: {
  filename: string;
  description: string;
  rows: (data: ShopExportData) => readonly Row[];
  columns: Column<Row>[];
}): Dataset {
  return {
    filename: definition.filename,
    description: definition.description,
    columnDocs: definition.columns.map(({ header, description }) => ({ header, description })),
    toCsv: (data) =>
      toCsv(
        definition.columns.map((column) => column.header),
        definition.rows(data).map((row) => definition.columns.map((column) => column.value(row))),
      ),
    rowCount: (data) => definition.rows(data).length,
  };
}

const money = "in minor units (cents)";

/**
 * Every file in the bundle, in the order the README documents them. Headers
 * are the database column names (snake_case) so the published schema and the
 * export never disagree.
 */
export const EXPORT_DATASETS: readonly Dataset[] = [
  dataset({
    filename: "shop.csv",
    description: "Your shop profile and settings — one row.",
    rows: (data) => [data.shop],
    columns: [
      {
        header: "id",
        description: "Shop id; every other file's shop-owned rows reference it implicitly",
        value: (s: Shop) => s.id,
      },
      { header: "name", description: "Shop name", value: (s: Shop) => s.name },
      { header: "slug", description: "URL slug", value: (s: Shop) => s.slug },
      {
        header: "timezone",
        description: "IANA timezone all schedules display in",
        value: (s: Shop) => s.timezone,
      },
      {
        header: "jurisdiction",
        description: "Medical questionnaire set (rstc or uk)",
        value: (s: Shop) => s.jurisdiction,
      },
      {
        header: "contact_email",
        description: "Public front-desk email",
        value: (s: Shop) => s.contactEmail,
      },
      {
        header: "contact_phone",
        description: "Public front-desk phone",
        value: (s: Shop) => s.contactPhone,
      },
      {
        header: "packing_list",
        description: "Diver packing suggestions (JSON array)",
        value: (s: Shop) => s.packingList,
      },
      {
        header: "rental_items",
        description: "Gear kinds the shop rents (JSON array)",
        value: (s: Shop) => s.rentalItems,
      },
      {
        header: "rental_pricing",
        description: `Rental price card (JSON; amounts ${money})`,
        value: (s: Shop) => s.rentalPricing,
      },
      {
        header: "dock_call_minutes",
        description: "Minutes before departure divers are asked to arrive",
        value: (s: Shop) => s.dockCallMinutes,
      },
      {
        header: "created_at",
        description: "When the shop was created (ISO 8601, UTC)",
        value: (s: Shop) => s.createdAt,
      },
    ],
  }),
  dataset({
    filename: "people.csv",
    description:
      "Every person your shop knows — divers, staff, or both. Roles are semicolon-separated. Archived people are included with archived_at set, because their history is still yours.",
    rows: (data) => data.people,
    columns: [
      {
        header: "id",
        description: "Person id referenced by bookings, certifications, waivers…",
        value: (p: Person & { roles: Role[] }) => p.id,
      },
      { header: "full_name", description: "Full name", value: (p: Person) => p.fullName },
      { header: "email", description: "Email, when on file", value: (p: Person) => p.email },
      { header: "phone", description: "Phone, when on file", value: (p: Person) => p.phone },
      {
        header: "emergency_contact_name",
        description: "Emergency contact name",
        value: (p: Person) => p.emergencyContactName,
      },
      {
        header: "emergency_contact_phone",
        description: "Emergency contact phone",
        value: (p: Person) => p.emergencyContactPhone,
      },
      {
        header: "roles",
        description:
          "Roles at this shop, semicolon-separated (owner; manager; instructor; divemaster; captain; crew; diver)",
        value: (p: Person & { roles: Role[] }) => p.roles.join("; "),
      },
      {
        header: "archived_at",
        description: "Set when the person was archived; empty for active people",
        value: (p: Person) => p.deletedAt,
      },
      {
        header: "created_at",
        description: "When the record was created",
        value: (p: Person) => p.createdAt,
      },
    ],
  }),
  dataset({
    filename: "certifications.csv",
    description:
      "Recreational-ladder certification cards (Open Water … Instructor). status distinguishes verified evidence from pending claims — carry that distinction into any system you import this into. Card photos are linked by URL.",
    rows: (data) => data.certifications,
    columns: [
      { header: "id", description: "Certification id", value: (c: Certification) => c.id },
      {
        header: "person_id",
        description: "The diver (people.csv)",
        value: (c: Certification) => c.personId,
      },
      {
        header: "agency",
        description: "Certifying agency (padi, ssi, naui, sdi, tdi, other)",
        value: (c: Certification) => c.agency,
      },
      {
        header: "level",
        description: "Ladder level (open_water … instructor)",
        value: (c: Certification) => c.level,
      },
      {
        header: "identifier",
        description: "Card number as printed",
        value: (c: Certification) => c.identifier,
      },
      {
        header: "status",
        description: "pending (claimed) or verified (staff checked the card)",
        value: (c: Certification) => c.status,
      },
      {
        header: "card_image_url",
        description: "Durable URL of the card photo, when captured",
        value: (c: Certification) => c.cardImageUrl,
      },
      {
        header: "expires_at",
        description: "Card expiry, when the agency sets one",
        value: (c: Certification) => c.expiresAt,
      },
      {
        header: "review_note",
        description: "Staff note from verification",
        value: (c: Certification) => c.reviewNote,
      },
      {
        header: "reviewed_at",
        description: "When staff verified the card",
        value: (c: Certification) => c.reviewedAt,
      },
      {
        header: "archived_at",
        description: "Set when the card was archived",
        value: (c: Certification) => c.deletedAt,
      },
      {
        header: "created_at",
        description: "When the card was recorded",
        value: (c: Certification) => c.createdAt,
      },
    ],
  }),
  dataset({
    filename: "specialty-certifications.csv",
    description:
      "Specialty cards (deep, wreck, night, drysuit) — yes/no gates rather than ladder rungs, so they live apart from certifications.csv.",
    rows: (data) => data.specialtyCertifications,
    columns: [
      {
        header: "id",
        description: "Specialty certification id",
        value: (c: SpecialtyCertification) => c.id,
      },
      {
        header: "person_id",
        description: "The diver (people.csv)",
        value: (c: SpecialtyCertification) => c.personId,
      },
      {
        header: "agency",
        description: "Certifying agency",
        value: (c: SpecialtyCertification) => c.agency,
      },
      {
        header: "specialty",
        description: "deep, wreck, night, or drysuit",
        value: (c: SpecialtyCertification) => c.specialty,
      },
      {
        header: "identifier",
        description: "Card number as printed",
        value: (c: SpecialtyCertification) => c.identifier,
      },
      {
        header: "status",
        description: "pending or verified",
        value: (c: SpecialtyCertification) => c.status,
      },
      {
        header: "card_image_url",
        description: "Durable URL of the card photo, when captured",
        value: (c: SpecialtyCertification) => c.cardImageUrl,
      },
      {
        header: "expires_at",
        description: "Card expiry, when set",
        value: (c: SpecialtyCertification) => c.expiresAt,
      },
      {
        header: "review_note",
        description: "Staff note from verification",
        value: (c: SpecialtyCertification) => c.reviewNote,
      },
      {
        header: "reviewed_at",
        description: "When staff verified the card",
        value: (c: SpecialtyCertification) => c.reviewedAt,
      },
      {
        header: "archived_at",
        description: "Set when the card was archived",
        value: (c: SpecialtyCertification) => c.deletedAt,
      },
      {
        header: "created_at",
        description: "When the card was recorded",
        value: (c: SpecialtyCertification) => c.createdAt,
      },
    ],
  }),
  dataset({
    filename: "nitrox-certifications.csv",
    description: "Nitrox (EANx) cards — the gate for enriched-air requests on bookings.",
    rows: (data) => data.nitroxCertifications,
    columns: [
      {
        header: "id",
        description: "Nitrox certification id",
        value: (c: NitroxCertification) => c.id,
      },
      {
        header: "person_id",
        description: "The diver (people.csv)",
        value: (c: NitroxCertification) => c.personId,
      },
      {
        header: "agency",
        description: "Certifying agency",
        value: (c: NitroxCertification) => c.agency,
      },
      {
        header: "identifier",
        description: "Card number as printed",
        value: (c: NitroxCertification) => c.identifier,
      },
      {
        header: "status",
        description: "pending or verified",
        value: (c: NitroxCertification) => c.status,
      },
      {
        header: "review_note",
        description: "Staff note from verification",
        value: (c: NitroxCertification) => c.reviewNote,
      },
      {
        header: "reviewed_at",
        description: "When staff verified the card",
        value: (c: NitroxCertification) => c.reviewedAt,
      },
      {
        header: "archived_at",
        description: "Set when the card was archived",
        value: (c: NitroxCertification) => c.deletedAt,
      },
      {
        header: "created_at",
        description: "When the card was recorded",
        value: (c: NitroxCertification) => c.createdAt,
      },
    ],
  }),
  dataset({
    filename: "waiver-templates.csv",
    description:
      "Every version of every release template, including archived versions — signed records reference these by id and version.",
    rows: (data) => data.waiverTemplates,
    columns: [
      { header: "id", description: "Template version id", value: (t: WaiverTemplate) => t.id },
      { header: "title", description: "Template title", value: (t: WaiverTemplate) => t.title },
      {
        header: "version",
        description: "Version number; templates version by insertion, never by edit",
        value: (t: WaiverTemplate) => t.version,
      },
      {
        header: "body",
        description: "Full release text of this version",
        value: (t: WaiverTemplate) => t.body,
      },
      {
        header: "archived_at",
        description: "Set when this version left active use",
        value: (t: WaiverTemplate) => t.archivedAt,
      },
      {
        header: "created_at",
        description: "When this version was published",
        value: (t: WaiverTemplate) => t.createdAt,
      },
    ],
  }),
  dataset({
    filename: "waiver-records.csv",
    description:
      "Signed releases and their full evidence: the exact text signed (snapshot at signing time), the signature, and the medical questionnaire answers as JSON. Pending rows are links that were issued but never completed. Signing-link secrets are never exported.",
    rows: (data) => data.waiverRecords,
    columns: [
      { header: "id", description: "Waiver record id", value: (w: WaiverRecord) => w.id },
      {
        header: "person_id",
        description: "The diver the release belongs to (people.csv)",
        value: (w: WaiverRecord) => w.personId,
      },
      {
        header: "booking_id",
        description: "The booking the link was issued from (bookings.csv)",
        value: (w: WaiverRecord) => w.bookingId,
      },
      {
        header: "template_id",
        description: "Template version signed (waiver-templates.csv)",
        value: (w: WaiverRecord) => w.templateId,
      },
      {
        header: "template_title",
        description: "Template title at signing time",
        value: (w: WaiverRecord) => w.templateTitle,
      },
      {
        header: "template_version",
        description: "Template version at signing time",
        value: (w: WaiverRecord) => w.templateVersion,
      },
      {
        header: "template_body",
        description: "The exact release text presented and signed — immutable evidence",
        value: (w: WaiverRecord) => w.templateBody,
      },
      {
        header: "status",
        description: "pending, completed, or medical_review",
        value: (w: WaiverRecord) => w.status,
      },
      {
        header: "signed_name",
        description: "Name as signed",
        value: (w: WaiverRecord) => w.signedName,
      },
      {
        header: "signature_method",
        description: "How the signature was captured",
        value: (w: WaiverRecord) => w.signatureMethod,
      },
      {
        header: "recorded_by_person_id",
        description: "Staff member who attested an in-person signature; empty for self-service",
        value: (w: WaiverRecord) => w.recordedByPersonId,
      },
      {
        header: "medical_answers",
        description:
          "Questionnaire answers (JSON: questionnaire id, version, and per-question yes/no)",
        value: (w: WaiverRecord) => w.medicalAnswers,
      },
      {
        header: "medical_review_required",
        description: "Whether the answers flagged a physician review",
        value: (w: WaiverRecord) => w.medicalReviewRequired,
      },
      {
        header: "consented_at",
        description: "When consent was recorded",
        value: (w: WaiverRecord) => w.consentedAt,
      },
      {
        header: "signed_at",
        description: "When the signature was captured",
        value: (w: WaiverRecord) => w.signedAt,
      },
      {
        header: "completed_at",
        description: "When the record completed",
        value: (w: WaiverRecord) => w.completedAt,
      },
      {
        header: "expires_at",
        description: "When the signing link expires/expired",
        value: (w: WaiverRecord) => w.expiresAt,
      },
      {
        header: "superseded_at",
        description: "Set when a newer link replaced this pending one",
        value: (w: WaiverRecord) => w.supersededAt,
      },
      {
        header: "created_at",
        description: "When the link was issued",
        value: (w: WaiverRecord) => w.createdAt,
      },
    ],
  }),
  dataset({
    filename: "trips.csv",
    description: "Every trip and course session ever scheduled, including cancelled ones.",
    rows: (data) => data.trips,
    columns: [
      { header: "id", description: "Trip id", value: (t: Trip) => t.id },
      { header: "title", description: "Trip title", value: (t: Trip) => t.title },
      { header: "description", description: "Trip description", value: (t: Trip) => t.description },
      { header: "status", description: "scheduled or cancelled", value: (t: Trip) => t.status },
      {
        header: "starts_at",
        description: "Departure (ISO 8601, UTC — display in shop.csv's timezone)",
        value: (t: Trip) => t.startsAt,
      },
      { header: "ends_at", description: "Return", value: (t: Trip) => t.endsAt },
      { header: "capacity", description: "Boat capacity (seats)", value: (t: Trip) => t.capacity },
      {
        header: "planned_dives",
        description: "Planned dive count (drives roll-call checkpoints)",
        value: (t: Trip) => t.plannedDives,
      },
      {
        header: "price_cents",
        description: `Per-diver price ${money}; empty means unpriced`,
        value: (t: Trip) => t.priceCents,
      },
      {
        header: "deposit_cents",
        description: `Optional per-diver deposit ${money}`,
        value: (t: Trip) => t.depositCents,
      },
      {
        header: "cancellation_window_hours",
        description: "Stated free-cancellation window, hours before departure",
        value: (t: Trip) => t.cancellationWindowHours,
      },
      {
        header: "series_id",
        description: "Recurring series this trip was created from (trip-series.csv), when any",
        value: (t: Trip) => t.seriesId,
      },
      {
        header: "course_id",
        description: "Course this session teaches (courses.csv), when any",
        value: (t: Trip) => t.courseId,
      },
      {
        header: "dive_site_id",
        description: "First dive's site (dive-sites.csv), when chosen",
        value: (t: Trip) => t.diveSiteId,
      },
      {
        header: "conditions_summary",
        description: "Staff conditions note",
        value: (t: Trip) => t.conditionsSummary,
      },
      {
        header: "water_temperature_c",
        description: "Reported water temperature, °C",
        value: (t: Trip) => t.waterTemperatureC,
      },
      {
        header: "visibility_meters",
        description: "Reported visibility, meters",
        value: (t: Trip) => t.visibilityMeters,
      },
      {
        header: "surface_conditions",
        description: "Reported surface conditions",
        value: (t: Trip) => t.surfaceConditions,
      },
      {
        header: "conditions_updated_at",
        description: "When conditions were last updated",
        value: (t: Trip) => t.conditionsUpdatedAt,
      },
      {
        header: "created_at",
        description: "When the trip was scheduled",
        value: (t: Trip) => t.createdAt,
      },
    ],
  }),
  dataset({
    filename: "trip-dives.csv",
    description: "The ordered dives within each trip, where the crew has planned them.",
    rows: (data) => data.tripDives,
    columns: [
      { header: "id", description: "Trip dive id", value: (d: TripDive) => d.id },
      { header: "trip_id", description: "The trip (trips.csv)", value: (d: TripDive) => d.tripId },
      {
        header: "dive_number",
        description: "Position within the trip (1, 2, …)",
        value: (d: TripDive) => d.diveNumber,
      },
      { header: "title", description: "Dive title, when named", value: (d: TripDive) => d.title },
      {
        header: "dive_site_id",
        description: "Site for this dive (dive-sites.csv), when chosen",
        value: (d: TripDive) => d.diveSiteId,
      },
      {
        header: "description",
        description: "Dive plan notes",
        value: (d: TripDive) => d.description,
      },
      {
        header: "created_at",
        description: "When the dive was added",
        value: (d: TripDive) => d.createdAt,
      },
    ],
  }),
  dataset({
    filename: "trip-requirements.csv",
    description:
      "The boarding gates each trip enforces — waiver, certification level, specialties, nitrox, payment.",
    rows: (data) => data.tripRequirements,
    columns: [
      {
        header: "trip_id",
        description: "The trip (trips.csv)",
        value: (r: TripRequirement) => r.tripId,
      },
      {
        header: "requires_waiver",
        description: "Whether a completed release is required to board",
        value: (r: TripRequirement) => r.requiresWaiver,
      },
      {
        header: "minimum_certification_level",
        description: "Required ladder level; empty means no C-card gate",
        value: (r: TripRequirement) => r.minimumCertificationLevel,
      },
      {
        header: "required_specialties",
        description: "Trip-level specialty gates (JSON array)",
        value: (r: TripRequirement) => r.requiredSpecialties,
      },
      {
        header: "requires_nitrox",
        description: "Whether a verified nitrox card is required",
        value: (r: TripRequirement) => r.requiresNitrox,
      },
      {
        header: "requires_payment",
        description: "Whether payment (or waived/deposit) is required to board",
        value: (r: TripRequirement) => r.requiresPayment,
      },
      {
        header: "created_at",
        description: "When requirements were set",
        value: (r: TripRequirement) => r.createdAt,
      },
      {
        header: "updated_at",
        description: "When requirements last changed",
        value: (r: TripRequirement) => r.updatedAt,
      },
    ],
  }),
  dataset({
    filename: "trip-series.csv",
    description: "Recurring-trip templates; each instance is an independent row in trips.csv.",
    rows: (data) => data.tripSeries,
    columns: [
      { header: "id", description: "Series id", value: (s: TripSeries) => s.id },
      { header: "title", description: "Series title", value: (s: TripSeries) => s.title },
      {
        header: "frequency",
        description: "Cadence (weekly)",
        value: (s: TripSeries) => s.frequency,
      },
      {
        header: "interval_weeks",
        description: "Weeks between instances",
        value: (s: TripSeries) => s.intervalWeeks,
      },
      {
        header: "occurrence_count",
        description: "Instances materialized at creation",
        value: (s: TripSeries) => s.occurrenceCount,
      },
      {
        header: "created_at",
        description: "When the series was created",
        value: (s: TripSeries) => s.createdAt,
      },
    ],
  }),
  dataset({
    filename: "crew-assignments.csv",
    description: "Which staff crewed which trip. Roles live on people.csv.",
    rows: (data) => data.tripAssignments,
    columns: [
      {
        header: "trip_id",
        description: "The trip (trips.csv)",
        value: (a: { tripId: string; personId: string }) => a.tripId,
      },
      {
        header: "person_id",
        description: "The crew member (people.csv)",
        value: (a: { tripId: string; personId: string }) => a.personId,
      },
    ],
  }),
  dataset({
    filename: "bookings.csv",
    description: "Every seat ever booked, with its lifecycle status.",
    rows: (data) => data.bookings,
    columns: [
      { header: "id", description: "Booking id", value: (b: Booking) => b.id },
      { header: "trip_id", description: "The trip (trips.csv)", value: (b: Booking) => b.tripId },
      {
        header: "person_id",
        description: "The diver (people.csv)",
        value: (b: Booking) => b.personId,
      },
      {
        header: "status",
        description: "booked, checked_in, cancelled, or no_show",
        value: (b: Booking) => b.status,
      },
      {
        header: "buddy_preference",
        description: "Requested buddy, when stated",
        value: (b: Booking) => b.buddyPreference,
      },
      {
        header: "wants_nitrox",
        description: "Whether the diver requested enriched air (per dive)",
        value: (b: Booking) => b.wantsNitrox,
      },
      {
        header: "conditions_briefed_at",
        description: "When staff briefed the diver on conditions",
        value: (b: Booking) => b.conditionsBriefedAt,
      },
      {
        header: "created_at",
        description: "When the booking was made",
        value: (b: Booking) => b.createdAt,
      },
    ],
  }),
  dataset({
    filename: "waitlist-entries.csv",
    description: "Divers in line for full trips. A wait-list entry never consumed a seat.",
    rows: (data) => data.waitlistEntries,
    columns: [
      { header: "id", description: "Waitlist entry id", value: (w: TripWaitlistEntry) => w.id },
      {
        header: "trip_id",
        description: "The full trip (trips.csv)",
        value: (w: TripWaitlistEntry) => w.tripId,
      },
      {
        header: "person_id",
        description: "The waiting diver (people.csv)",
        value: (w: TripWaitlistEntry) => w.personId,
      },
      {
        header: "invited_at",
        description: "When staff last invited this diver to a freed seat",
        value: (w: TripWaitlistEntry) => w.invitedAt,
      },
      {
        header: "created_at",
        description: "When the diver joined the list",
        value: (w: TripWaitlistEntry) => w.createdAt,
      },
    ],
  }),
  dataset({
    filename: "booking-payments.csv",
    description: "The current payment state of each booking.",
    rows: (data) => data.bookingPayments,
    columns: [
      { header: "id", description: "Payment record id", value: (p: BookingPayment) => p.id },
      {
        header: "booking_id",
        description: "The booking (bookings.csv)",
        value: (p: BookingPayment) => p.bookingId,
      },
      {
        header: "status",
        description: "unpaid, deposit_paid, paid, waived, or refunded",
        value: (p: BookingPayment) => p.status,
      },
      {
        header: "amount_cents",
        description: `Amount ${money}`,
        value: (p: BookingPayment) => p.amountCents,
      },
      {
        header: "currency",
        description: "ISO currency code",
        value: (p: BookingPayment) => p.currency,
      },
      {
        header: "provider",
        description: "Payment provider (e.g. stripe); empty for a manual mark",
        value: (p: BookingPayment) => p.provider,
      },
      {
        header: "provider_ref",
        description: "Provider's reference for the payment",
        value: (p: BookingPayment) => p.providerRef,
      },
      { header: "note", description: "Staff note", value: (p: BookingPayment) => p.note },
      {
        header: "updated_at",
        description: "When the state last changed",
        value: (p: BookingPayment) => p.updatedAt,
      },
      {
        header: "created_at",
        description: "When the record was created",
        value: (p: BookingPayment) => p.createdAt,
      },
    ],
  }),
  dataset({
    filename: "orders.csv",
    description:
      "Shop-issued orders and invoices, with their Stripe references — usable to reconcile against your own Stripe account, which stays yours.",
    rows: (data) => data.orders,
    columns: [
      { header: "id", description: "Order id", value: (o: Order) => o.id },
      {
        header: "person_id",
        description: "The customer (people.csv)",
        value: (o: Order) => o.personId,
      },
      {
        header: "booking_id",
        description: "The booking this order settles (bookings.csv), when any",
        value: (o: Order) => o.bookingId,
      },
      {
        header: "created_by_person_id",
        description: "Staff member who raised the order (people.csv)",
        value: (o: Order) => o.createdByPersonId,
      },
      {
        header: "status",
        description: "open, paid, void, uncollectible, or refunded",
        value: (o: Order) => o.status,
      },
      { header: "currency", description: "ISO currency code", value: (o: Order) => o.currency },
      {
        header: "total_cents",
        description: `Order total ${money}`,
        value: (o: Order) => o.totalCents,
      },
      {
        header: "amount_paid_cents",
        description: `Amount paid so far ${money}`,
        value: (o: Order) => o.amountPaidCents,
      },
      {
        header: "description",
        description: "Order description",
        value: (o: Order) => o.description,
      },
      {
        header: "stripe_invoice_id",
        description: "Stripe invoice id on your connected account",
        value: (o: Order) => o.stripeInvoiceId,
      },
      {
        header: "hosted_invoice_url",
        description: "Stripe-hosted invoice page",
        value: (o: Order) => o.hostedInvoiceUrl,
      },
      {
        header: "invoice_pdf_url",
        description: "Stripe invoice PDF",
        value: (o: Order) => o.invoicePdfUrl,
      },
      {
        header: "finalized_at",
        description: "When the invoice was finalized",
        value: (o: Order) => o.finalizedAt,
      },
      { header: "paid_at", description: "When it was paid", value: (o: Order) => o.paidAt },
      { header: "voided_at", description: "When it was voided", value: (o: Order) => o.voidedAt },
      {
        header: "refunded_at",
        description: "When it was refunded",
        value: (o: Order) => o.refundedAt,
      },
      {
        header: "created_at",
        description: "When the order was raised",
        value: (o: Order) => o.createdAt,
      },
    ],
  }),
  dataset({
    filename: "order-line-items.csv",
    description: "The lines on each order.",
    rows: (data) => data.orderLineItems,
    columns: [
      { header: "id", description: "Line item id", value: (l: OrderLineItem) => l.id },
      {
        header: "order_id",
        description: "The order (orders.csv)",
        value: (l: OrderLineItem) => l.orderId,
      },
      {
        header: "kind",
        description:
          "trip_fee, course_fee, e_learning_fee, rental, nitrox, deposit, merchandise, or other",
        value: (l: OrderLineItem) => l.kind,
      },
      {
        header: "description",
        description: "Line description",
        value: (l: OrderLineItem) => l.description,
      },
      { header: "quantity", description: "Quantity", value: (l: OrderLineItem) => l.quantity },
      {
        header: "unit_amount_cents",
        description: `Unit amount ${money}`,
        value: (l: OrderLineItem) => l.unitAmountCents,
      },
      {
        header: "created_at",
        description: "When the line was added",
        value: (l: OrderLineItem) => l.createdAt,
      },
    ],
  }),
  dataset({
    filename: "roll-call-events.csv",
    description:
      "The append-only boarding safety history: every roll-call answer ever recorded, at departure and after each dive, including offline-recorded events and corrections. Nothing here was ever rewritten.",
    rows: (data) => data.rollCallEvents,
    columns: [
      { header: "id", description: "Event id", value: (e: RollCallEvent) => e.id },
      {
        header: "trip_id",
        description: "The trip (trips.csv)",
        value: (e: RollCallEvent) => e.tripId,
      },
      {
        header: "booking_id",
        description: "The diver's booking (bookings.csv)",
        value: (e: RollCallEvent) => e.bookingId,
      },
      {
        header: "recorded_by_person_id",
        description: "Staff member who recorded it (people.csv)",
        value: (e: RollCallEvent) => e.recordedByPersonId,
      },
      {
        header: "status",
        description: "boarded, not_boarded, or cleared (a recorded correction)",
        value: (e: RollCallEvent) => e.status,
      },
      {
        header: "checkpoint",
        description: "departure or after_dive_N",
        value: (e: RollCallEvent) => e.checkpoint,
      },
      { header: "source", description: "live or offline", value: (e: RollCallEvent) => e.source },
      { header: "note", description: "Staff note", value: (e: RollCallEvent) => e.note },
      {
        header: "occurred_at",
        description: "When the roll call happened",
        value: (e: RollCallEvent) => e.occurredAt,
      },
      {
        header: "created_at",
        description: "When the event reached the server",
        value: (e: RollCallEvent) => e.createdAt,
      },
    ],
  }),
  dataset({
    filename: "rental-fit-profiles.csv",
    description:
      "Each diver's reusable rental fit — what they take from the shop and in what size.",
    rows: (data) => data.rentalFitProfiles,
    columns: [
      { header: "id", description: "Profile id", value: (r: RentalFitProfile) => r.id },
      {
        header: "person_id",
        description: "The diver (people.csv)",
        value: (r: RentalFitProfile) => r.personId,
      },
      {
        header: "rents_bcd",
        description: "Takes a shop BCD",
        value: (r: RentalFitProfile) => r.rentsBcd,
      },
      {
        header: "rents_regulator",
        description: "Takes a shop regulator",
        value: (r: RentalFitProfile) => r.rentsRegulator,
      },
      {
        header: "rents_wetsuit",
        description: "Takes a shop wetsuit",
        value: (r: RentalFitProfile) => r.rentsWetsuit,
      },
      {
        header: "rents_mask_fins",
        description: "Takes shop mask & fins",
        value: (r: RentalFitProfile) => r.rentsMaskFins,
      },
      {
        header: "rents_weights",
        description: "Takes shop weights",
        value: (r: RentalFitProfile) => r.rentsWeights,
      },
      {
        header: "rents_dive_computer",
        description: "Takes a shop dive computer",
        value: (r: RentalFitProfile) => r.rentsDiveComputer,
      },
      {
        header: "rents_gopro",
        description: "Takes a shop GoPro",
        value: (r: RentalFitProfile) => r.rentsGopro,
      },
      { header: "bcd_size", description: "BCD size", value: (r: RentalFitProfile) => r.bcdSize },
      {
        header: "wetsuit_size",
        description: "Wetsuit size",
        value: (r: RentalFitProfile) => r.wetsuitSize,
      },
      { header: "boot_size", description: "Boot size", value: (r: RentalFitProfile) => r.bootSize },
      { header: "fin_size", description: "Fin size", value: (r: RentalFitProfile) => r.finSize },
      {
        header: "weight_preference",
        description: "Weight preference",
        value: (r: RentalFitProfile) => r.weightPreference,
      },
      { header: "note", description: "Fit note", value: (r: RentalFitProfile) => r.note },
      {
        header: "updated_at",
        description: "When the fit last changed",
        value: (r: RentalFitProfile) => r.updatedAt,
      },
      {
        header: "created_at",
        description: "When the fit was first recorded",
        value: (r: RentalFitProfile) => r.createdAt,
      },
    ],
  }),
  dataset({
    filename: "dive-sites.csv",
    description:
      "Your dive-site briefing library, including archived sites. Images are linked by URL.",
    rows: (data) => data.diveSites,
    columns: [
      { header: "id", description: "Site id", value: (s: DiveSite) => s.id },
      { header: "name", description: "Site name", value: (s: DiveSite) => s.name },
      {
        header: "description",
        description: "Briefing description",
        value: (s: DiveSite) => s.description,
      },
      { header: "location_name", description: "Location", value: (s: DiveSite) => s.locationName },
      {
        header: "difficulty",
        description: "Difficulty note",
        value: (s: DiveSite) => s.difficulty,
      },
      { header: "depth_range", description: "Depth range", value: (s: DiveSite) => s.depthRange },
      {
        header: "current_note",
        description: "Current note",
        value: (s: DiveSite) => s.currentNote,
      },
      { header: "dive_plan", description: "Dive plan", value: (s: DiveSite) => s.divePlan },
      {
        header: "marine_life",
        description: "Marine life summary",
        value: (s: DiveSite) => s.marineLife,
      },
      {
        header: "marine_life_description",
        description: "Marine life detail",
        value: (s: DiveSite) => s.marineLifeDescription,
      },
      {
        header: "landmarks",
        description: "Landmarks (JSON array)",
        value: (s: DiveSite) => s.landmarks,
      },
      {
        header: "minimum_certification_level",
        description: "The site's own cert gate; empty means none",
        value: (s: DiveSite) => s.minimumCertificationLevel,
      },
      {
        header: "required_specialties",
        description: "Specialties the site demands (JSON array)",
        value: (s: DiveSite) => s.requiredSpecialties,
      },
      {
        header: "requires_nitrox",
        description: "Whether the site demands a verified nitrox card",
        value: (s: DiveSite) => s.requiresNitrox,
      },
      {
        header: "forecast_latitude",
        description: "Forecast coordinate",
        value: (s: DiveSite) => s.forecastLatitude,
      },
      {
        header: "forecast_longitude",
        description: "Forecast coordinate",
        value: (s: DiveSite) => s.forecastLongitude,
      },
      {
        header: "satellite_image_url",
        description: "Satellite image URL",
        value: (s: DiveSite) => s.satelliteImageUrl,
      },
      {
        header: "route_image_url",
        description: "Route image URL",
        value: (s: DiveSite) => s.routeImageUrl,
      },
      {
        header: "image_urls",
        description: "Photo URLs (JSON array)",
        value: (s: DiveSite) => s.imageUrls,
      },
      {
        header: "archived_at",
        description: "Set when the site was archived",
        value: (s: DiveSite) => s.deletedAt,
      },
      {
        header: "created_at",
        description: "When the site was added",
        value: (s: DiveSite) => s.createdAt,
      },
    ],
  }),
  dataset({
    filename: "courses.csv",
    description: "Your course catalog, including hidden courses and their public-page content.",
    rows: (data) => data.courses,
    columns: [
      { header: "id", description: "Course id", value: (c: Course) => c.id },
      { header: "title", description: "Course title", value: (c: Course) => c.title },
      { header: "agency", description: "Certifying agency", value: (c: Course) => c.agency },
      { header: "slug", description: "Public page slug", value: (c: Course) => c.slug },
      { header: "description", description: "Internal blurb", value: (c: Course) => c.description },
      { header: "summary", description: "Public summary", value: (c: Course) => c.summary },
      { header: "overview", description: "Public overview", value: (c: Course) => c.overview },
      {
        header: "price_cents",
        description: `Course price ${money}`,
        value: (c: Course) => c.priceCents,
      },
      {
        header: "e_learning_price_cents",
        description: `E-learning add-on price ${money}`,
        value: (c: Course) => c.eLearningPriceCents,
      },
      {
        header: "minimum_certification_level",
        description: "Agency-set entry gate; empty means uncertified may enroll",
        value: (c: Course) => c.minimumCertificationLevel,
      },
      { header: "minimum_age", description: "Minimum age", value: (c: Course) => c.minimumAge },
      {
        header: "duration_text",
        description: "Duration, as published",
        value: (c: Course) => c.durationText,
      },
      {
        header: "group_size_text",
        description: "Group size, as published",
        value: (c: Course) => c.groupSizeText,
      },
      {
        header: "prerequisite_note",
        description: "Prerequisite prose beside the cert gate",
        value: (c: Course) => c.prerequisiteNote,
      },
      {
        header: "includes",
        description: "What's included (JSON array)",
        value: (c: Course) => c.includes,
      },
      {
        header: "excludes",
        description: "What's not included (JSON array)",
        value: (c: Course) => c.excludes,
      },
      {
        header: "schedule_days",
        description: "Published schedule (JSON)",
        value: (c: Course) => c.scheduleDays,
      },
      { header: "faqs", description: "Published FAQs (JSON)", value: (c: Course) => c.faqs },
      {
        header: "hero_image_url",
        description: "Hero image URL",
        value: (c: Course) => c.heroImageUrl,
      },
      {
        header: "image_urls",
        description: "Photo URLs (JSON array)",
        value: (c: Course) => c.imageUrls,
      },
      {
        header: "is_active",
        description: "Whether the course is currently offered",
        value: (c: Course) => c.isActive,
      },
      {
        header: "created_at",
        description: "When the course was created",
        value: (c: Course) => c.createdAt,
      },
    ],
  }),
];

/** What deliberately stays out of the bundle, stated in the README so absence reads as policy, not accident. */
const NOT_EXPORTED = [
  "Login credentials — passwords are hashes that belong to no one; people set new ones wherever they land.",
  "Waiver signing-link tokens — single-use secrets, useless and unsafe outside DiveDay.",
  "Notification delivery logs — operational plumbing, not your business records.",
  "Image files — card photos and site images are linked by durable URL in the CSVs rather than embedded.",
] as const;

function readme(data: ShopExportData, generatedAt: Date): string {
  const sections = EXPORT_DATASETS.map((entry) => {
    const columns = entry.columnDocs
      .map((column) => `| \`${column.header}\` | ${column.description} |`)
      .join("\n");
    return [
      `## ${entry.filename}`,
      "",
      `${entry.description} (${entry.rowCount(data)} rows)`,
      "",
      "| Column | Meaning |",
      "| --- | --- |",
      columns,
    ].join("\n");
  });
  return [
    `# DiveDay data export — ${data.shop.name}`,
    "",
    `Generated ${generatedAt.toISOString()}.`,
    "",
    "This is all of it — every record your shop owns, in plain CSV (UTF-8, RFC 4180) that opens",
    "in any spreadsheet and imports anywhere. Timestamps are ISO 8601 in UTC; money columns are",
    "minor units (cents); JSON columns hold structured values as JSON text. Ids are stable across",
    "files, so rows join exactly as they do inside DiveDay.",
    "",
    "Your data is yours. Export it as often as you like, and take it with you if you ever leave.",
    "",
    "## What is deliberately not included",
    "",
    ...NOT_EXPORTED.map((line) => `- ${line}`),
    "",
    ...sections,
    "",
  ].join("\n");
}

/** The bundle as named file contents — README first, then every dataset. */
export function buildExportFiles(
  data: ShopExportData,
  generatedAt: Date = nowDate(),
): Record<string, string> {
  const files: Record<string, string> = { "README.md": readme(data, generatedAt) };
  for (const entry of EXPORT_DATASETS) files[entry.filename] = entry.toCsv(data);
  return files;
}

export function exportFilename(shopSlug: string, generatedAt: Date = nowDate()): string {
  return `diveday-export-${shopSlug}-${generatedAt.toISOString().slice(0, 10)}.zip`;
}

/** The one-button artifact: the whole bundle as a ZIP. */
export function zipExportBundle(data: ShopExportData, generatedAt: Date = nowDate()): Uint8Array {
  const files = buildExportFiles(data, generatedAt);
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])),
  );
}
