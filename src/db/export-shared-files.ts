import { verifyCourseFormIntegrity } from "@/lib/course-form-integrity";
import type { CsvValue } from "@/lib/export";
import { EXPORT_FILE_NOTES } from "@/lib/export";
import type { DiverExportContext, ShopExportContext } from "./export";
import type { ExportFileSpec } from "./export-tables";
import type { reviewModerationEvents } from "./schema";

/**
 * **The files both bundles write, each declared once** (ADR
 * 20260722-full-shop-export, ADR 20260824-diver-record-export).
 *
 * A table the shop bundle exports and a diver's own bundle also answers with
 * is one spec here: one column list, in the shop file's order, where every
 * column says which bundle writes it —
 *
 * - `"both"`: the diver's bundle carries it too. Its value reads only what
 *   both contexts hold (`ShopExportContext | DiverExportContext`), so it is
 *   computed the same way for the shop and for the diver.
 * - `"shop"`: the shop's alone — another person's id, a staff-only note, a
 *   foreign key into a file the diver does not get.
 * - `"diver"`: the diver's alone, in place of a shop column it answers for
 *   (a reviewer's *name* where the shop file carries their id).
 *
 * The scope is required, so a column added here is a decision about the
 * diver's bundle at the moment it is added, never a silent omission (code
 * review 2026-10-10, finding 6). Rows come from each bundle's own loader —
 * `loadShopExportContext` reads the shop, `loadDiverExportContext` reads only
 * what is this diver's — so the spec decides columns, never which rows.
 *
 * `SHOP_EXPORT_FILES` and `DIVER_EXPORT_FILES` place each spec at its file's
 * position in their bundle through `shopFile` and `diverFile`. Files only one
 * bundle writes stay in that bundle's own list.
 */

type ScopedColumn<Row> =
  | {
      header: string;
      in: "both";
      value: (row: Row, context: ShopExportContext | DiverExportContext) => CsvValue;
    }
  | { header: string; in: "shop"; value: (row: Row, context: ShopExportContext) => CsvValue }
  | { header: string; in: "diver"; value: (row: Row, context: DiverExportContext) => CsvValue };

/** One row of a shop-context list, by the list's name. */
type ShopRow<K extends keyof ShopExportContext> =
  ShopExportContext[K] extends readonly (infer Row)[] ? Row : never;

export type SharedExportFile<Row> = {
  file: string;
  columns: readonly ScopedColumn<Row>[];
  shop: { rows: (context: ShopExportContext) => readonly Row[]; note: string };
  diver: { rows: (context: DiverExportContext) => readonly Row[]; note: string };
};

function sharedFile<Row>(spec: SharedExportFile<Row>): SharedExportFile<Row> {
  return spec;
}

/** The shop bundle's file: every column but the diver-only ones. */
export function shopFile<Row>(spec: SharedExportFile<Row>): ExportFileSpec<ShopExportContext> {
  const columns = spec.columns.filter((column) => column.in !== "diver");
  return {
    file: spec.file,
    header: columns.map((column) => column.header),
    rows: (context) =>
      spec.shop.rows(context).map((row) => {
        const cells: CsvValue[] = [];
        for (const column of spec.columns) {
          if (column.in !== "diver") cells.push(column.value(row, context));
        }
        return cells;
      }),
    note: spec.shop.note,
  };
}

/** A diver's own file: every column but the shop-only ones. */
export function diverFile<Row>(spec: SharedExportFile<Row>): ExportFileSpec<DiverExportContext> {
  const columns = spec.columns.filter((column) => column.in !== "shop");
  return {
    file: spec.file,
    header: columns.map((column) => column.header),
    rows: (context) =>
      spec.diver.rows(context).map((row) => {
        const cells: CsvValue[] = [];
        for (const column of spec.columns) {
          if (column.in !== "shop") cells.push(column.value(row, context));
        }
        return cells;
      }),
    note: spec.diver.note,
  };
}

/**
 * Who an invitation is for: the person it names, or — for one raised from a
 * course inquiry by someone with no record yet — the inquiry's own person.
 */
function invitee(
  row: { personId: string | null; courseInquiryId: string | null },
  inquiryById: ShopExportContext["inquiryById"],
) {
  const inquiry = row.courseInquiryId ? inquiryById.get(row.courseInquiryId) : undefined;
  return { personId: row.personId ?? inquiry?.personId ?? null, inquiry };
}

/** A person's name when there is a person, and nothing when there is not. */
function nameOf(personName: ReadonlyMap<string, string>, personId: string | null | undefined) {
  return personId ? personName.get(personId) : null;
}

export const CERTIFICATIONS_CSV = sharedFile<ShopRow<"certificationRows">>({
  file: "certifications.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "agency", in: "both", value: (row) => row.agency },
    { header: "level", in: "both", value: (row) => row.level },
    { header: "identifier", in: "both", value: (row) => row.identifier },
    // The number the *diver* typed, which is never the number above: one
    // is a claim and one is what the shop holds, and a file that
    // merged them would launder the first into the second on the way
    // back in (issue #630).
    { header: "declared_identifier", in: "both", value: (row) => row.declaredIdentifier },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "review_note", in: "both", value: (row) => row.reviewNote },
    { header: "reviewed_at", in: "both", value: (row) => row.reviewedAt },
    {
      header: "reviewed_by_name",
      in: "diver",
      value: (row, { personName }) =>
        row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
    },
    { header: "reviewed_by_person_id", in: "shop", value: (row) => row.reviewedByPersonId },
    // Set when the review was the agency's own page, read through the
    // DiveDay browser extension (H-105); review_note then holds its words.
    { header: "agency_checked_at", in: "both", value: (row) => row.agencyCheckedAt },
    // Provenance from the contact importer (ADR 20260724-import-verified-cards):
    // a non-null imported_at is the definitive "this card was migrated, not
    // carded on sight" marker, permanent even after a staff confirm.
    { header: "imported_at", in: "both", value: (row) => row.importedAt },
    { header: "imported_from_label", in: "both", value: (row) => row.importedFromLabel },
    // The weaker sibling of imported_at, and it travels for the same
    // reason: a non-null self_declared_at means the level came off a
    // public opt-in the diver filled in themselves, with no card
    // sighted. Dropping it from the export would launder a claim into
    // an ordinary card the moment the file is read back.
    { header: "self_declared_at", in: "both", value: (row) => row.selfDeclaredAt },
    // A third provenance, alongside imported_at and self_declared_at
    // above: a non-null issued_by_shop_at means this shop's own
    // instructor certified the diver from a course session's roster
    // (issue #717), never a captured or self-declared card.
    // issued_from_trip_id names that session; issued_by_person_id
    // names the instructor. Same reasoning as the other two
    // provenance stamps — dropping any of the three from the export
    // would launder one kind of card into another on the way back in.
    { header: "issued_by_shop_at", in: "shop", value: (row) => row.issuedByShopAt },
    { header: "issued_from_trip_id", in: "shop", value: (row) => row.issuedFromTripId },
    { header: "issued_by_person_id", in: "shop", value: (row) => row.issuedByPersonId },
    { header: "deleted_at", in: "both", value: (row) => row.deletedAt },
    { header: "deleted_by_person_id", in: "shop", value: (row) => row.deletedByPersonId },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ certificationRows }) => certificationRows,
    note: EXPORT_FILE_NOTES["certifications.csv"],
  },
  diver: {
    rows: ({ certificationRows }) => certificationRows,
    note: "Certification records this shop holds on file, with their verification status.",
  },
});

export const SPECIALTY_CERTIFICATIONS_CSV = sharedFile<ShopRow<"specialtyRows">>({
  file: "specialty_certifications.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "agency", in: "both", value: (row) => row.agency },
    { header: "specialty", in: "both", value: (row) => row.specialty },
    { header: "identifier", in: "both", value: (row) => row.identifier },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "review_note", in: "both", value: (row) => row.reviewNote },
    { header: "reviewed_at", in: "both", value: (row) => row.reviewedAt },
    {
      header: "reviewed_by_name",
      in: "diver",
      value: (row, { personName }) =>
        row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
    },
    { header: "reviewed_by_person_id", in: "shop", value: (row) => row.reviewedByPersonId },
    { header: "deleted_at", in: "both", value: (row) => row.deletedAt },
    { header: "deleted_by_person_id", in: "shop", value: (row) => row.deletedByPersonId },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ specialtyRows }) => specialtyRows,
    note: EXPORT_FILE_NOTES["specialty_certifications.csv"],
  },
  diver: {
    rows: ({ specialtyRows }) => specialtyRows,
    note: "Specialty certifications (deep, wreck, night, drysuit) with their verification status.",
  },
});

export const NITROX_CERTIFICATIONS_CSV = sharedFile<ShopRow<"nitroxRows">>({
  file: "nitrox_certifications.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "agency", in: "both", value: (row) => row.agency },
    { header: "identifier", in: "both", value: (row) => row.identifier },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "review_note", in: "both", value: (row) => row.reviewNote },
    { header: "reviewed_at", in: "both", value: (row) => row.reviewedAt },
    {
      header: "reviewed_by_name",
      in: "diver",
      value: (row, { personName }) =>
        row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
    },
    { header: "reviewed_by_person_id", in: "shop", value: (row) => row.reviewedByPersonId },
    { header: "imported_at", in: "both", value: (row) => row.importedAt },
    { header: "imported_from_label", in: "both", value: (row) => row.importedFromLabel },
    // Same reason as the level card's — see certifications.csv above.
    { header: "self_declared_at", in: "both", value: (row) => row.selfDeclaredAt },
    { header: "deleted_at", in: "both", value: (row) => row.deletedAt },
    { header: "deleted_by_person_id", in: "shop", value: (row) => row.deletedByPersonId },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ nitroxRows }) => nitroxRows,
    note: EXPORT_FILE_NOTES["nitrox_certifications.csv"],
  },
  diver: {
    rows: ({ nitroxRows }) => nitroxRows,
    note: "Nitrox (EANx) certification with its verification status.",
  },
});

// Diver: party_lead_booking_id is deliberately not a column here: on a
// Diver: shared booking it is another diver's booking id, and it is a
// Diver: foreign key this diver has no reason to hold — see the module
// Diver: docblock's shared-row decisions.
export const BOOKINGS_CSV = sharedFile<ShopRow<"bookingRows">>({
  file: "bookings.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "trip_id", in: "shop", value: (row) => row.tripId },
    { header: "trip_title", in: "both", value: (row, { tripTitle }) => tripTitle.get(row.tripId) },
    {
      header: "trip_starts_at",
      in: "both",
      value: (row, { tripStartsAt }) => tripStartsAt.get(row.tripId),
    },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "status", in: "both", value: (row) => row.status },
    // Diver, snorkeler or rider (ADR 20261007-participant-types): what
    // this seat was for, and which gates it was asked to clear; and
    // what it was sold as, which differs when staff changed it.
    { header: "participant_type", in: "both", value: (row) => row.participantType },
    { header: "booked_as", in: "both", value: (row) => row.bookedAs },
    { header: "wants_nitrox", in: "both", value: (row) => row.wantsNitrox },
    { header: "conditions_briefed_at", in: "both", value: (row) => row.conditionsBriefedAt },
    // What the diver said this dive was for, and the one support they
    // asked for when they said they were easing back (ADR
    // 20260904-reef-all-the-way-down). Codes rather than words: an
    // export is the shop's own database handed back, and the sentence a
    // diver read was in whichever language they read it in.
    { header: "dive_intent", in: "both", value: (row) => row.diveIntent },
    { header: "re_entry_ask", in: "both", value: (row) => row.reEntryAsk },
    // The diver's own answer to "when did you last dive?" (ADR
    // 20260821-currency-is-what-catches-people). A statement they made
    // about themselves, on the seat they made it for — the same kind of
    // record as `dive_intent` beside it, and a shop moving its data
    // elsewhere should not have to ask every returning diver again.
    { header: "last_dived_band", in: "both", value: (row) => row.lastDivedBand },
    // The party structure a shop booked (ADR 20260804-seat-claim-links).
    // Both are real records of what happened to a seat, so both travel:
    // `party_lead_booking_id` is a booking id from this same file's `id`
    // column, and `claimed_at` sits alongside `conditions_briefed_at` as
    // another plain fact about the seat. Dropping either would let a shop
    // export a party of six and get back six unrelated singles.
    { header: "party_lead_booking_id", in: "shop", value: (row) => row.partyLeadBookingId },
    { header: "claimed_at", in: "both", value: (row) => row.claimedAt },
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
    { header: "referral_source", in: "shop", value: (row) => row.referralSource },
    // **Which diver's link brought this one** (the buddy seat, ADR
    // 20260908-one-hand, decision 6, lever W). A plain fact about the
    // seat, in exactly the class `party_lead_booking_id` and
    // `referral_source` above are in, so it travels with it rather
    // than in a file of its own.
    {
      header: "referred_by_booking_id",
      in: "shop",
      value: (row, { buddyReferralByBooking }) => buddyReferralByBooking.get(row.id),
    },
    // The diver's own consent to have the crew told this is a first
    // trip, or a return after a long gap (issue #1182). A statement
    // they made about themselves on this seat, the same kind of record
    // as `last_dived_band` above — and a shop that moved its data would
    // otherwise be asking every one of them again.
    { header: "welcome_shared_at", in: "shop", value: (row) => row.welcomeSharedAt },
    // The diver answering "nothing has changed" about the sizes, gas
    // and emergency contact the shop already holds (ADR
    // 20260904-reef-all-the-way-down, D15). Same class as the two
    // columns above: a statement they made about themselves on this
    // seat, and a shop that moved its data would otherwise ask the
    // whole board the question over again.
    {
      header: "carried_facts_confirmed_at",
      in: "shop",
      value: (row) => row.carriedFactsConfirmedAt,
    },
    // The diver saying they were running late (J3): a statement they
    // made on this seat, in the same class as the two above.
    // "Running late" (J3): a statement the diver made, so it is theirs.
    { header: "running_late_at", in: "both", value: (row) => row.runningLateAt },
    // The instructor's own words to this student, and who wrote them
    // (issues #1196, #1205). The student read it on their recap; a
    // shop moving its data takes the sentence with it.
    { header: "course_next_step", in: "shop", value: (row) => row.courseNextStep },
    { header: "course_next_step_at", in: "shop", value: (row) => row.courseNextStepAt },
    {
      header: "course_next_step_by_person_id",
      in: "shop",
      value: (row) => row.courseNextStepByPersonId,
    },
    // The tick that this student finished the course's learning
    // materials, and who ticked it (ADR 20261008-course-learning-materials).
    { header: "course_materials_done_at", in: "shop", value: (row) => row.courseMaterialsDoneAt },
    {
      header: "course_materials_done_by_person_id",
      in: "shop",
      value: (row) => row.courseMaterialsDoneByPersonId,
    },
    { header: "hotel_pickup_location", in: "shop", value: (row) => row.hotelPickupLocation },
    { header: "pickup_time", in: "shop", value: (row) => row.pickupTime },
    {
      header: "payment_status",
      in: "both",
      value: (row, { paymentByBooking }) => paymentByBooking.get(row.id)?.status ?? "unpaid",
    },
    {
      header: "payment_amount_cents",
      in: "both",
      value: (row, { paymentByBooking }) => paymentByBooking.get(row.id)?.amountCents,
    },
    {
      header: "payment_currency",
      in: "both",
      value: (row, { paymentByBooking }) => paymentByBooking.get(row.id)?.currency,
    },
    {
      header: "payment_provider",
      in: "both",
      value: (row, { paymentByBooking }) => paymentByBooking.get(row.id)?.provider,
    },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: { rows: ({ bookingRows }) => bookingRows, note: EXPORT_FILE_NOTES["bookings.csv"] },
  diver: {
    rows: ({ bookingRows }) => bookingRows,
    note: "Every booking this diver has held at this shop, with its current payment state.",
  },
});

export const WAITLIST_ENTRIES_CSV = sharedFile<ShopRow<"waitlistRows">>({
  file: "waitlist_entries.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "trip_id", in: "shop", value: (row) => row.tripId },
    { header: "trip_title", in: "both", value: (row, { tripTitle }) => tripTitle.get(row.tripId) },
    {
      header: "trip_starts_at",
      in: "both",
      value: (row, { tripStartsAt }) => tripStartsAt.get(row.tripId),
    },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "invited_at", in: "both", value: (row) => row.invitedAt },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ waitlistRows }) => waitlistRows,
    note: EXPORT_FILE_NOTES["waitlist_entries.csv"],
  },
  diver: {
    rows: ({ waitlistRows }) => waitlistRows,
    note: "Full trips this diver joined the wait list for.",
  },
});

export const TRIP_INVITATIONS_CSV = sharedFile<ShopRow<"invitationRows">>({
  file: "trip_invitations.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "trip_id", in: "shop", value: (row) => row.tripId },
    { header: "trip_title", in: "both", value: (row, { tripTitle }) => tripTitle.get(row.tripId) },
    {
      header: "trip_starts_at",
      in: "both",
      value: (row, { tripStartsAt }) => tripStartsAt.get(row.tripId),
    },
    { header: "source", in: "both", value: (row) => row.source },
    { header: "course_inquiry_id", in: "shop", value: (row) => row.courseInquiryId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { inquiryById }) => invitee(row, inquiryById).personId,
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { inquiryById, personName }) => {
        const { personId, inquiry } = invitee(row, inquiryById);
        return personId ? personName.get(personId) : inquiry?.name;
      },
    },
    { header: "created_by_person_id", in: "shop", value: (row) => row.createdByPersonId },
    {
      header: "created_by_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.createdByPersonId),
    },
    { header: "invited_at", in: "both", value: (row) => row.invitedAt },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ invitationRows }) => invitationRows,
    note: EXPORT_FILE_NOTES["trip_invitations.csv"],
  },
  diver: {
    rows: ({ invitationRows }) => invitationRows,
    note: "Staff outreach inviting this diver to a departure without claiming a seat.",
  },
});

export const LAST_MINUTE_LIST_CSV = sharedFile<ShopRow<"lastMinuteListRows">>({
  file: "last_minute_list.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "available_from", in: "both", value: (row) => row.availableFrom },
    { header: "available_until", in: "both", value: (row) => row.availableUntil },
    { header: "unsubscribed_at", in: "both", value: (row) => row.unsubscribedAt },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ lastMinuteListRows }) => lastMinuteListRows,
    note: EXPORT_FILE_NOTES["last_minute_list.csv"],
  },
  diver: {
    rows: ({ lastMinuteListRows }) => lastMinuteListRows,
    note: "This diver's opt-in to hear about last-minute deals shop-wide, and the date range they gave.",
  },
});

export const TRIP_LAST_MINUTE_PROMO_RECIPIENTS_CSV = sharedFile<
  ShopRow<"lastMinutePromoRecipientRows">
>({
  file: "trip_last_minute_promo_recipients.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "trip_promo_id", in: "both", value: (row) => row.tripPromoId },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "email", in: "both", value: (row) => row.email },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ lastMinutePromoRecipientRows }) => lastMinutePromoRecipientRows,
    note: EXPORT_FILE_NOTES["trip_last_minute_promo_recipients.csv"],
  },
  diver: {
    rows: ({ lastMinutePromoRecipientRows }) => lastMinutePromoRecipientRows,
    note: "Last-minute deal blasts this diver was sent.",
  },
});

export const BOOKING_PAYMENT_EVENTS_CSV = sharedFile<ShopRow<"paymentEventRows">>({
  file: "booking_payment_events.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { bookingPerson }) => bookingPerson.get(row.bookingId),
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(personName, bookingPerson.get(row.bookingId)),
    },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "previous_status", in: "both", value: (row) => row.previousStatus },
    { header: "amount_cents", in: "both", value: (row) => row.amountCents },
    { header: "currency", in: "both", value: (row) => row.currency },
    { header: "provider", in: "both", value: (row) => row.provider },
    { header: "provider_ref", in: "shop", value: (row) => row.providerRef },
    { header: "operation", in: "both", value: (row) => row.operation },
    { header: "note", in: "shop", value: (row) => row.note },
    { header: "occurred_at", in: "both", value: (row) => row.occurredAt },
  ],
  shop: {
    rows: ({ paymentEventRows }) => paymentEventRows,
    note: EXPORT_FILE_NOTES["booking_payment_events.csv"],
  },
  diver: {
    rows: ({ paymentEventRows }) => paymentEventRows,
    note: "Every recorded change to this diver's payment state, oldest first.",
  },
});

// Diver: The checkout attempt itself (booking_checkouts.csv in the shop
// Diver: bundle) is not included: one attempt can cover a whole party
// Diver: sharing a single Stripe session, so its customer_email and totals
// Diver: may not be this diver's — see the module docblock. This is only
// Diver: this diver's own seat within any such attempt.
export const BOOKING_CHECKOUT_BOOKINGS_CSV = sharedFile<ShopRow<"checkoutBookingRows">>({
  file: "booking_checkout_bookings.csv",
  columns: [
    { header: "checkout_id", in: "both", value: (row) => row.checkoutId },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { bookingPerson }) => bookingPerson.get(row.bookingId) ?? null,
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(personName, bookingPerson.get(row.bookingId)),
    },
    { header: "trip_cents", in: "both", value: (row) => row.tripCents },
    { header: "gear_cents", in: "both", value: (row) => row.gearCents },
    { header: "pass_through_cents", in: "shop", value: (row) => row.passThroughCents },
    { header: "tax_cents", in: "shop", value: (row) => row.taxCents },
  ],
  shop: {
    rows: ({ checkoutBookingRows }) => checkoutBookingRows,
    note: EXPORT_FILE_NOTES["booking_checkout_bookings.csv"],
  },
  diver: {
    rows: ({ checkoutBookingRows }) => checkoutBookingRows,
    note: "Rental gear charged on this diver's own seat within a checkout attempt.",
  },
});

export const BOOKING_ARRIVAL_EVENTS_CSV = sharedFile<ShopRow<"arrivalRows">>({
  file: "booking_arrival_events.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "trip_id", in: "shop", value: (row) => row.tripId },
    { header: "trip_title", in: "both", value: (row, { tripTitle }) => tripTitle.get(row.tripId) },
    {
      header: "trip_starts_at",
      in: "both",
      value: (row, { tripStartsAt }) => tripStartsAt.get(row.tripId),
    },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { bookingPerson }) => bookingPerson.get(row.bookingId),
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(personName, bookingPerson.get(row.bookingId)),
    },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "source", in: "both", value: (row) => row.source },
    { header: "client_event_id", in: "shop", value: (row) => row.clientEventId },
    { header: "offline_snapshot_saved_at", in: "shop", value: (row) => row.offlineSnapshotSavedAt },
    { header: "recorded_by_person_id", in: "shop", value: (row) => row.recordedByPersonId },
    {
      header: "recorded_by_name",
      in: "both",
      value: (row, { personName }) => personName.get(row.recordedByPersonId),
    },
    { header: "occurred_at", in: "both", value: (row) => row.occurredAt },
    { header: "created_at", in: "shop", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ arrivalRows }) => arrivalRows,
    note: EXPORT_FILE_NOTES["booking_arrival_events.csv"],
  },
  diver: {
    rows: ({ arrivalRows }) => arrivalRows,
    note: "When this diver was checked in at the counter, and when that was taken back. Arriving is not boarding — that is roll_call_events.csv.",
  },
});

// Diver: `note` (a free-text field staff can type at the rail) is
// Diver: deliberately not a column here — see activity_events in "Not
// Diver: included": free text on this table can name a different diver, and
// Diver: safely redacting it needs the same sweep the erasure path uses.
export const ROLL_CALL_EVENTS_CSV = sharedFile<ShopRow<"rollCallRows">>({
  file: "roll_call_events.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "trip_id", in: "shop", value: (row) => row.tripId },
    { header: "trip_title", in: "both", value: (row, { tripTitle }) => tripTitle.get(row.tripId) },
    {
      header: "trip_starts_at",
      in: "both",
      value: (row, { tripStartsAt }) => tripStartsAt.get(row.tripId),
    },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { bookingPerson }) => bookingPerson.get(row.bookingId),
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(personName, bookingPerson.get(row.bookingId)),
    },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "checkpoint", in: "both", value: (row) => row.checkpoint },
    { header: "source", in: "shop", value: (row) => row.source },
    { header: "client_event_id", in: "shop", value: (row) => row.clientEventId },
    { header: "offline_snapshot_saved_at", in: "shop", value: (row) => row.offlineSnapshotSavedAt },
    { header: "recorded_by_person_id", in: "shop", value: (row) => row.recordedByPersonId },
    {
      header: "recorded_by_name",
      in: "both",
      value: (row, { personName }) => personName.get(row.recordedByPersonId),
    },
    { header: "note", in: "shop", value: (row) => row.note },
    { header: "occurred_at", in: "both", value: (row) => row.occurredAt },
    { header: "created_at", in: "shop", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ rollCallRows }) => rollCallRows,
    note: EXPORT_FILE_NOTES["roll_call_events.csv"],
  },
  diver: {
    rows: ({ rollCallRows }) => rollCallRows,
    note: "This diver's own boarding and roll-call record.",
  },
});

// Shop: One row per member, diver or crew (ADR 20260804-buddy-teams).
// Shop: `person_id` resolves to the same thing either way — the human — so a
// Shop: reader who only cares "who was on this team" reads one column;
// Shop: `member_kind` is what tells them whether that human held a seat.
// Diver: Only this diver's own membership row per team: filtered to their
// Diver: own bookings/crew id, so another member's row is never selected in
// Diver: the first place — see the module docblock.
export const BUDDY_PAIRS_CSV = sharedFile<ShopRow<"buddyPairRows">>({
  file: "buddy_pairs.csv",
  columns: [
    { header: "pair_id", in: "both", value: (row) => row.pairId },
    { header: "trip_id", in: "shop", value: (row) => row.tripId },
    { header: "trip_title", in: "both", value: (row, { tripTitle }) => tripTitle.get(row.tripId) },
    {
      header: "trip_starts_at",
      in: "both",
      value: (row, { tripStartsAt }) => tripStartsAt.get(row.tripId),
    },
    { header: "member_kind", in: "both", value: (row) => (row.bookingId ? "diver" : "crew") },
    { header: "booking_id", in: "shop", value: (row) => row.bookingId },
    { header: "crew_person_id", in: "shop", value: (row) => row.crewPersonId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { bookingPerson }) =>
        row.bookingId ? (bookingPerson.get(row.bookingId) ?? null) : row.crewPersonId,
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(personName, row.bookingId ? bookingPerson.get(row.bookingId) : row.crewPersonId),
    },
    { header: "paired_by_person_id", in: "shop", value: (row) => row.pairedByPersonId },
    {
      header: "paired_by_name",
      in: "both",
      value: (row, { personName }) => personName.get(row.pairedByPersonId),
    },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: { rows: ({ buddyPairRows }) => buddyPairRows, note: EXPORT_FILE_NOTES["buddy_pairs.csv"] },
  diver: {
    rows: ({ buddyPairRows }) => buddyPairRows,
    note: "Buddy teams this diver was recorded on. Other members are not named here.",
  },
});

// Diver: medical_answers is deliberately absent — see the module docblock.
export const WAIVER_RECORDS_CSV = sharedFile<ShopRow<"waiverRows">>({
  file: "waiver_records.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    { header: "template_id", in: "shop", value: (row) => row.templateId },
    { header: "template_title", in: "both", value: (row) => row.templateTitle },
    { header: "template_version", in: "both", value: (row) => row.templateVersion },
    { header: "template_generation", in: "shop", value: (row) => row.templateGeneration },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "signed_name", in: "both", value: (row) => row.signedName },
    { header: "signature_method", in: "both", value: (row) => row.signatureMethod },
    { header: "recorded_by_person_id", in: "shop", value: (row) => row.recordedByPersonId },
    {
      header: "recorded_by_name",
      in: "both",
      value: (row, { personName }) =>
        row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
    },
    { header: "started_at", in: "both", value: (row) => row.startedAt },
    { header: "consented_at", in: "both", value: (row) => row.consentedAt },
    { header: "signed_at", in: "both", value: (row) => row.signedAt },
    { header: "completed_at", in: "both", value: (row) => row.completedAt },
    { header: "medical_review_required", in: "both", value: (row) => row.medicalReviewRequired },
    {
      header: "medical_answers",
      in: "shop",
      value: (row) => (row.medicalAnswers ? JSON.stringify(row.medicalAnswers) : null),
    },
    // The physician clearance that ends a medical hold (issue #1252).
    // Its *document* is deliberately not here — see EXCLUDED_COLUMNS in
    // src/db/export.test.ts — but the fact and its accountable staff
    // member are the shop's own evidence, and a restore that lost them
    // would re-block every cleared diver with no record of who cleared
    // them or when the physician evaluated them.
    // The clearance is the diver's own fact — a physician evaluated
    // them and the shop recorded it — so it belongs in their bundle
    // even though the answers behind it do not. The staff member who
    // recorded it is named for the same reason `recorded_by_name` is.
    { header: "medical_cleared_at", in: "both", value: (row) => row.medicalClearedAt },
    {
      header: "medical_cleared_by_person_id",
      in: "shop",
      value: (row) => row.medicalClearedByPersonId,
    },
    {
      header: "medical_cleared_by_name",
      in: "both",
      value: (row, { personName }) =>
        row.medicalClearedByPersonId ? personName.get(row.medicalClearedByPersonId) : null,
    },
    // The same act with the opposite answer (issue #1283), exported for
    // the same reason and with more force: a refusal is the record of
    // why a diver stayed ashore, and a restore that lost it would show
    // the destination a diver still "awaiting" an answer that arrived
    // months ago. Its document is excluded exactly as the clearance's
    // is; the fact and its accountable staff member are the shop's own.
    // And the refusal (issue #1283), which is the diver's own fact more
    // plainly than the clearance is: it is the finding that kept them
    // off a boat, and a subject-access bundle that withheld it would be
    // hiding from somebody the one record they are most entitled to.
    {
      header: "medical_clearance_declined_at",
      in: "both",
      value: (row) => row.medicalClearanceDeclinedAt,
    },
    {
      header: "medical_clearance_declined_by_person_id",
      in: "shop",
      value: (row) => row.medicalClearanceDeclinedByPersonId,
    },
    {
      header: "medical_clearance_declined_by_name",
      in: "both",
      value: (row, { personName }) =>
        row.medicalClearanceDeclinedByPersonId
          ? personName.get(row.medicalClearanceDeclinedByPersonId)
          : null,
    },
    {
      header: "medical_clearance_evaluated_on",
      in: "both",
      value: (row) => row.medicalClearanceEvaluatedOn,
    },
    {
      header: "medical_clearance_physician_name",
      in: "both",
      value: (row) => row.medicalClearancePhysicianName,
    },
    // The guardian's half of a minor's release (ADR
    // 20260907-guardian-co-signature): who co-signed, as what, how,
    // and when. Inside the seal, so a destination that re-verified the
    // hash without them would read every minor's release as tampered.
    // Who co-signed, when the diver was a minor: the guardian's name
    // and email are a third party's personal data, but they are on
    // *this diver's* release, which is the record the subject-access
    // bundle exists to hand over whole (ADR 20260907-guardian-co-signature).
    { header: "guardian_name", in: "both", value: (row) => row.guardianName },
    { header: "guardian_relationship", in: "both", value: (row) => row.guardianRelationship },
    { header: "guardian_email", in: "both", value: (row) => row.guardianEmail },
    {
      header: "guardian_signature_method",
      in: "both",
      value: (row) => row.guardianSignatureMethod,
    },
    { header: "guardian_consented_at", in: "both", value: (row) => row.guardianConsentedAt },
    { header: "guardian_signed_at", in: "both", value: (row) => row.guardianSignedAt },
    { header: "integrity_hash", in: "shop", value: (row) => row.integrityHash },
    { header: "integrity_version", in: "shop", value: (row) => row.integrityVersion },
    { header: "superseded_at", in: "both", value: (row) => row.supersededAt },
    { header: "expires_at", in: "both", value: (row) => row.expiresAt },
    { header: "imported_from_label", in: "shop", value: (row) => row.importedFromLabel },
    {
      header: "import_source_document_url",
      in: "shop",
      value: (row) => row.importSourceDocumentUrl,
    },
    {
      header: "import_source_medical_document_url",
      in: "shop",
      value: (row) => row.importSourceMedicalDocumentUrl,
    },
    // Which seal the row's `integrity_hash` is over: version 2 means
    // this release was stripped when its diver was erased, and the
    // signature and medical answers above are blank by decision rather
    // than by omission (ADR 20260802-diver-data-erasure).
    { header: "anonymized_at", in: "shop", value: (row) => row.anonymizedAt },
    { header: "anonymized_by_person_id", in: "shop", value: (row) => row.anonymizedByPersonId },
    // Version 3: the release followed its seat to a new diver record
    // (issue #2080). Inside the seal with `person_id`.
    { header: "moved_from_person_id", in: "shop", value: (row) => row.movedFromPersonId },
    { header: "moved_at", in: "shop", value: (row) => row.movedAt },
    { header: "moved_by_person_id", in: "shop", value: (row) => row.movedByPersonId },
    // Version 4: the guardian asked for their address to be erased and
    // the shop did (H-103, issue #1673). Inside the seal, so a
    // destination re-verifying it needs both.
    { header: "guardian_email_erased_at", in: "shop", value: (row) => row.guardianEmailErasedAt },
    {
      header: "guardian_email_erased_by_person_id",
      in: "shop",
      value: (row) => row.guardianEmailErasedByPersonId,
    },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: { rows: ({ waiverRows }) => waiverRows, note: EXPORT_FILE_NOTES["waiver_records.csv"] },
  diver: {
    rows: ({ waiverRows }) => waiverRows,
    note: "Waiver evidence this diver signed. Medical answers are withheld pending a legal review of subject-access scope.",
  },
});

export const COURSE_FORM_RECORDS_CSV = sharedFile<ShopRow<"courseFormRecordRows">>({
  file: "course_form_records.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    { header: "form_id", in: "shop", value: (row) => row.formId },
    { header: "form_version_id", in: "shop", value: (row) => row.formVersionId },
    { header: "form_title", in: "both", value: (row) => row.formTitle },
    { header: "form_version", in: "both", value: (row) => row.formVersion },
    { header: "course_title", in: "both", value: (row) => row.courseTitle },
    { header: "trip_id", in: "both", value: (row) => row.tripId },
    { header: "instructor_names", in: "both", value: (row) => row.instructorNames },
    { header: "paper_signed_on", in: "both", value: (row) => row.paperSignedOn },
    { header: "signed_name", in: "both", value: (row) => row.signedName },
    { header: "signature_method", in: "both", value: (row) => row.signatureMethod },
    { header: "recorded_by_person_id", in: "shop", value: (row) => row.recordedByPersonId },
    {
      header: "recorded_by_name",
      in: "both",
      value: (row, { personName }) =>
        row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
    },
    { header: "consented_at", in: "both", value: (row) => row.consentedAt },
    { header: "signed_at", in: "both", value: (row) => row.signedAt },
    // A minor's form names the guardian who co-signed it, on this diver's
    // own record — handed over whole, as the release's guardian is.
    { header: "guardian_name", in: "both", value: (row) => row.guardianName },
    { header: "guardian_relationship", in: "both", value: (row) => row.guardianRelationship },
    {
      header: "guardian_signature_method",
      in: "both",
      value: (row) => row.guardianSignatureMethod,
    },
    { header: "guardian_consented_at", in: "both", value: (row) => row.guardianConsentedAt },
    { header: "guardian_signed_at", in: "both", value: (row) => row.guardianSignedAt },
    { header: "anonymized_at", in: "shop", value: (row) => row.anonymizedAt },
    { header: "anonymized_by_person_id", in: "shop", value: (row) => row.anonymizedByPersonId },
    // The seal and, beside it, what it says at the moment of export
    // (issue #2266): `valid`, `invalid` or `unsealed`.
    { header: "integrity_hash", in: "shop", value: (row) => row.integrityHash },
    { header: "integrity_version", in: "shop", value: (row) => row.integrityVersion },
    { header: "integrity_check", in: "shop", value: (row) => verifyCourseFormIntegrity(row) },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
    { header: "form_body", in: "both", value: (row) => row.formBody },
  ],
  shop: {
    rows: ({ courseFormRecordRows }) => courseFormRecordRows,
    note: EXPORT_FILE_NOTES["course_form_records.csv"],
  },
  diver: {
    rows: ({ courseFormRecordRows }) => courseFormRecordRows,
    note: "Each course form this diver signed, with the words exactly as they read when signed.",
  },
});

export const RENTAL_FIT_CSV = sharedFile<ShopRow<"rentalFitRows">>({
  file: "rental_fit.csv",
  columns: [
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "rents_bcd", in: "both", value: (row) => row.rentsBcd },
    { header: "rents_regulator", in: "both", value: (row) => row.rentsRegulator },
    { header: "rents_wetsuit", in: "both", value: (row) => row.rentsWetsuit },
    { header: "rents_mask_fins", in: "both", value: (row) => row.rentsMaskFins },
    { header: "rents_weights", in: "both", value: (row) => row.rentsWeights },
    { header: "rents_dive_computer", in: "both", value: (row) => row.rentsDiveComputer },
    { header: "rents_gopro", in: "both", value: (row) => row.rentsGopro },
    { header: "rents_drysuit", in: "both", value: (row) => row.rentsDrysuit },
    { header: "rents_hood", in: "both", value: (row) => row.rentsHood },
    { header: "rents_gloves", in: "both", value: (row) => row.rentsGloves },
    { header: "rents_torch", in: "both", value: (row) => row.rentsTorch },
    { header: "rents_smb", in: "both", value: (row) => row.rentsSmb },
    { header: "bcd_size", in: "both", value: (row) => row.bcdSize },
    { header: "wetsuit_size", in: "both", value: (row) => row.wetsuitSize },
    { header: "drysuit_size", in: "both", value: (row) => row.drysuitSize },
    { header: "hood_size", in: "both", value: (row) => row.hoodSize },
    { header: "glove_size", in: "both", value: (row) => row.gloveSize },
    { header: "boot_size", in: "both", value: (row) => row.bootSize },
    { header: "fin_size", in: "both", value: (row) => row.finSize },
    { header: "weight_preference", in: "both", value: (row) => row.weightPreference },
    { header: "dives_dry", in: "both", value: (row) => row.divesDry },
    { header: "note", in: "shop", value: (row) => row.note },
    { header: "needs_staff_fit_at", in: "shop", value: (row) => row.needsStaffFitAt },
    { header: "needs_staff_fit_note", in: "shop", value: (row) => row.needsStaffFitNote },
    // Who raised the flag, by the same id + name pair every other
    // person reference in the bundle uses. A safety flag without its
    // attribution is a rumour.
    { header: "needs_staff_fit_by", in: "shop", value: (row) => row.needsStaffFitBy },
    {
      header: "needs_staff_fit_by_name",
      in: "shop",
      value: (row, { personName }) =>
        row.needsStaffFitBy ? personName.get(row.needsStaffFitBy) : null,
    },
    // A staffer keeping the size a unit actually came back in (issue
    // #1174). Carried for the same reason the flag above it is, and
    // with the same id + name pair: the diver's own thread reads this
    // back as "Keiko kept your BCD at M", so a bundle without the
    // attribution would restore a sentence with nobody in it. The
    // item says which piece, which is what stops the sentence naming
    // the wrong one.
    { header: "fit_confirmed_at", in: "shop", value: (row) => row.fitConfirmedAt },
    { header: "fit_confirmed_by", in: "shop", value: (row) => row.fitConfirmedBy },
    {
      header: "fit_confirmed_by_name",
      in: "shop",
      value: (row, { personName }) =>
        row.fitConfirmedBy ? personName.get(row.fitConfirmedBy) : null,
    },
    { header: "fit_confirmed_item", in: "shop", value: (row) => row.fitConfirmedItem },
    { header: "updated_at", in: "both", value: (row) => row.updatedAt },
  ],
  shop: { rows: ({ rentalFitRows }) => rentalFitRows, note: EXPORT_FILE_NOTES["rental_fit.csv"] },
  diver: {
    rows: ({ rentalFitRows }) => rentalFitRows,
    note: "This diver's rental kit and sizes on file.",
  },
});

export const GEAR_RESERVATIONS_CSV = sharedFile<ShopRow<"gearReservationRows">>({
  file: "gear_reservations.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "gear_item_id", in: "shop", value: (row) => row.gearItemId },
    {
      header: "gear_item_label",
      in: "both",
      value: (row, { gearItemLabel }) => gearItemLabel.get(row.gearItemId),
    },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    { header: "person_id", in: "both", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(
          personName,
          row.personId ?? (row.bookingId ? bookingPerson.get(row.bookingId) : null),
        ),
    },
    { header: "reserved_from", in: "both", value: (row) => row.reservedFrom },
    { header: "reserved_until", in: "both", value: (row) => row.reservedUntil },
    { header: "checked_out_at", in: "both", value: (row) => row.checkedOutAt },
    { header: "returned_at", in: "both", value: (row) => row.returnedAt },
    { header: "return_outcome", in: "shop", value: (row) => row.returnOutcome },
    { header: "return_note", in: "shop", value: (row) => row.returnNote },
    { header: "dives_logged", in: "shop", value: (row) => row.divesLogged },
    { header: "released_at", in: "both", value: (row) => row.releasedAt },
    { header: "released_by_person_id", in: "shop", value: (row) => row.releasedByPersonId },
    {
      header: "released_by_person_name",
      in: "shop",
      value: (row, { personName }) =>
        row.releasedByPersonId ? personName.get(row.releasedByPersonId) : null,
    },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ gearReservationRows }) => gearReservationRows,
    note: EXPORT_FILE_NOTES["gear_reservations.csv"],
  },
  diver: {
    rows: ({ gearReservationRows }) => gearReservationRows,
    note: "Rental gear reserved for this diver's own seats.",
  },
});

export const CUSTOMER_GEAR_ITEMS_CSV = sharedFile<ShopRow<"customerGearItemRows">>({
  file: "customer_gear_items.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "kind", in: "both", value: (row) => row.kind },
    { header: "brand_model", in: "both", value: (row) => row.brandModel },
    { header: "serial_number", in: "both", value: (row) => row.serialNumber },
    { header: "note", in: "both", value: (row) => row.note },
    { header: "service_due_on", in: "both", value: (row) => row.serviceDueOn },
    { header: "inspection_due_on", in: "both", value: (row) => row.inspectionDueOn },
    { header: "hydro_due_on", in: "both", value: (row) => row.hydroDueOn },
    { header: "deleted_at", in: "both", value: (row) => row.deletedAt },
    { header: "deleted_by_person_id", in: "shop", value: (row) => row.deletedByPersonId },
    {
      header: "deleted_by_name",
      in: "shop",
      value: (row, { personName }) =>
        row.deletedByPersonId ? personName.get(row.deletedByPersonId) : null,
    },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
    { header: "updated_at", in: "shop", value: (row) => row.updatedAt },
  ],
  shop: {
    rows: ({ customerGearItemRows }) => customerGearItemRows,
    note: EXPORT_FILE_NOTES["customer_gear_items.csv"],
  },
  diver: {
    rows: ({ customerGearItemRows }) => customerGearItemRows,
    note: "This diver's own gear the shop has on file, and when each piece is next due: a service date, or a cylinder's visual inspection and hydro test dates.",
  },
});

// Diver: The bench notes and the outcome note are deliberately absent: they are
// Diver: the shop's internal talk about a repair, written for a technician and
// Diver: never shown to a customer, and a diver's own bundle is what the shop
// Diver: hands *them*. The outcome itself — done, declined, unserviceable,
// Diver: condemned — is theirs to know.
export const WORK_ORDERS_CSV = sharedFile<ShopRow<"workOrderRows">>({
  file: "work_orders.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "number", in: "both", value: (row) => row.number },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => (row.personId ? personName.get(row.personId) : null),
    },
    { header: "gear_item_id", in: "shop", value: (row) => row.gearItemId },
    {
      header: "gear_item_label",
      in: "shop",
      value: (row, { gearItemLabel }) =>
        row.gearItemId ? gearItemLabel.get(row.gearItemId) : null,
    },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "reported_problem", in: "both", value: (row) => row.reportedProblem },
    { header: "promised_on", in: "both", value: (row) => row.promisedOn },
    { header: "technician_person_id", in: "shop", value: (row) => row.technicianPersonId },
    {
      header: "technician_name",
      in: "shop",
      value: (row, { personName }) =>
        row.technicianPersonId ? personName.get(row.technicianPersonId) : null,
    },
    { header: "technician_notes", in: "shop", value: (row) => row.technicianNotes },
    { header: "work_performed", in: "both", value: (row) => row.workPerformed },
    { header: "received_at", in: "both", value: (row) => row.receivedAt },
    { header: "ready_at", in: "both", value: (row) => row.readyAt },
    { header: "picked_up_at", in: "both", value: (row) => row.pickedUpAt },
    { header: "outcome", in: "both", value: (row) => row.outcome },
    { header: "outcome_note", in: "shop", value: (row) => row.outcomeNote },
    { header: "outcome_recorded_at", in: "shop", value: (row) => row.outcomeRecordedAt },
    {
      header: "outcome_recorded_by_person_id",
      in: "shop",
      value: (row) => row.outcomeRecordedByPersonId,
    },
    {
      header: "outcome_recorded_by_name",
      in: "shop",
      value: (row, { personName }) =>
        row.outcomeRecordedByPersonId ? personName.get(row.outcomeRecordedByPersonId) : null,
    },
    { header: "unit_prior_status", in: "shop", value: (row) => row.unitPriorStatus },
    { header: "unit_prior_service_note", in: "shop", value: (row) => row.unitPriorServiceNote },
    { header: "deleted_at", in: "both", value: (row) => row.deletedAt },
    { header: "deleted_by_person_id", in: "shop", value: (row) => row.deletedByPersonId },
    { header: "created_at", in: "shop", value: (row) => row.createdAt },
    { header: "updated_at", in: "shop", value: (row) => row.updatedAt },
  ],
  shop: { rows: ({ workOrderRows }) => workOrderRows, note: EXPORT_FILE_NOTES["work_orders.csv"] },
  diver: {
    rows: ({ workOrderRows }) => workOrderRows,
    note: "Service tickets for this diver's own gear, with what was reported and what was done.",
  },
});

export const WORK_ORDER_LINES_CSV = sharedFile<ShopRow<"workOrderLineRows">>({
  file: "work_order_lines.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "work_order_id", in: "both", value: (row) => row.workOrderId },
    { header: "kind", in: "both", value: (row) => row.kind },
    { header: "description", in: "both", value: (row) => row.description },
    { header: "quantity_hundredths", in: "both", value: (row) => row.quantityHundredths },
    { header: "unit_amount_cents", in: "both", value: (row) => row.unitAmountCents },
    { header: "deleted_at", in: "both", value: (row) => row.deletedAt },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
    { header: "updated_at", in: "shop", value: (row) => row.updatedAt },
  ],
  shop: {
    rows: ({ workOrderLineRows }) => workOrderLineRows,
    note: EXPORT_FILE_NOTES["work_order_lines.csv"],
  },
  diver: {
    rows: ({ workOrderLineRows }) => workOrderLineRows,
    note: "The parts and labor on this diver's own service tickets, in the shop's currency's minor unit.",
  },
});

export const WORK_ORDER_CARE_CSV = sharedFile<ShopRow<"workOrderCareRows">>({
  file: "work_order_care.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "work_order_id", in: "both", value: (row) => row.workOrderId },
    { header: "customer_gear_item_id", in: "both", value: (row) => row.customerGearItemId },
    { header: "kind", in: "both", value: (row) => row.kind },
    { header: "passed", in: "both", value: (row) => row.passed },
    { header: "performed_on", in: "both", value: (row) => row.performedOn },
    { header: "next_due_on", in: "both", value: (row) => row.nextDueOn },
    { header: "next_due_dives", in: "shop", value: (row) => row.nextDueDives },
    { header: "created_at", in: "shop", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ workOrderCareRows }) => workOrderCareRows,
    note: EXPORT_FILE_NOTES["work_order_care.csv"],
  },
  diver: {
    rows: ({ workOrderCareRows }) => workOrderCareRows,
    note: "The checks recorded on this diver's own gear: which care, whether it passed, the day it was done and the next due date the technician confirmed.",
  },
});

// Shop: History the shop brought in from its previous system
// Shop: (ADR 20260725-import-prior-visits). In the bundle because a shop's
// Shop: own history is its own to take back out, and out of the operational
// Shop: files because that is exactly what it never was.
export const PRIOR_VISITS_CSV = sharedFile<ShopRow<"priorVisitRows">>({
  file: "prior_visits.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "visited_on", in: "both", value: (row) => row.visitedOn },
    { header: "title", in: "both", value: (row) => row.title },
    { header: "status_label", in: "both", value: (row) => row.statusLabel },
    { header: "amount_label", in: "both", value: (row) => row.amountLabel },
    { header: "source_label", in: "both", value: (row) => row.sourceLabel },
    { header: "source_reference", in: "shop", value: (row) => row.sourceReference },
    { header: "imported_at", in: "both", value: (row) => row.importedAt },
  ],
  shop: {
    rows: ({ priorVisitRows }) => priorVisitRows,
    note: EXPORT_FILE_NOTES["prior_visits.csv"],
  },
  diver: {
    rows: ({ priorVisitRows }) => priorVisitRows,
    note: "Visit history the shop imported from its previous system for this diver.",
  },
});

// Shop: Separate source evidence, deliberately not folded into orders.csv:
// Shop: an old processor's receipt or Stripe reference is not a DiveDay
// Shop: invoice. The export keeps the source row portable without making
// Shop: the next system mistake it for a live payment.
export const IMPORTED_PAYMENT_HISTORY_CSV = sharedFile<ShopRow<"importedPaymentHistoryRows">>({
  file: "imported_payment_history.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "occurred_on", in: "both", value: (row) => row.occurredOn },
    { header: "direction", in: "both", value: (row) => row.direction },
    { header: "title", in: "both", value: (row) => row.title },
    { header: "status_label", in: "both", value: (row) => row.statusLabel },
    { header: "amount_label", in: "both", value: (row) => row.amountLabel },
    { header: "amount_cents", in: "both", value: (row) => row.amountCents },
    { header: "currency", in: "both", value: (row) => row.currency },
    { header: "payment_reference", in: "shop", value: (row) => row.paymentReference },
    { header: "receipt_reference", in: "shop", value: (row) => row.receiptReference },
    { header: "receipt_document_url", in: "shop", value: (row) => row.receiptDocumentUrl },
    { header: "source_label", in: "shop", value: (row) => row.sourceLabel },
    { header: "source_reference", in: "shop", value: (row) => row.sourceReference },
    { header: "stripe_reference", in: "shop", value: (row) => row.stripeReference },
    { header: "imported_at", in: "both", value: (row) => row.importedAt },
  ],
  shop: {
    rows: ({ importedPaymentHistoryRows }) => importedPaymentHistoryRows,
    note: EXPORT_FILE_NOTES["imported_payment_history.csv"],
  },
  diver: {
    rows: ({ importedPaymentHistoryRows }) => importedPaymentHistoryRows,
    note: "Payment source history the shop imported from its previous system for this diver.",
  },
});

export const NOTIFICATION_DELIVERIES_CSV = sharedFile<ShopRow<"notificationRows">>({
  file: "notification_deliveries.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { bookingPerson }) => bookingPerson.get(row.bookingId) ?? null,
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(personName, bookingPerson.get(row.bookingId)),
    },
    { header: "kind", in: "both", value: (row) => row.kind },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "provider_message_id", in: "shop", value: (row) => row.providerMessageId },
    { header: "provider_status", in: "both", value: (row) => row.providerStatus },
    { header: "provider_status_at", in: "shop", value: (row) => row.providerStatusAt },
    { header: "provider_detail", in: "shop", value: (row) => row.providerDetail },
    { header: "send_http_status", in: "shop", value: (row) => row.sendHttpStatus },
    { header: "send_error_code", in: "shop", value: (row) => row.sendErrorCode },
    { header: "send_error", in: "shop", value: (row) => row.sendError },
    { header: "attempted_at", in: "both", value: (row) => row.attemptedAt },
    { header: "created_at", in: "shop", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ notificationRows }) => notificationRows,
    note: EXPORT_FILE_NOTES["notification_deliveries.csv"],
  },
  diver: {
    rows: ({ notificationRows }) => notificationRows,
    note: "Whether this diver actually got each message the shop sent them — confirmation, waiver request, reminder, recap.",
  },
});

// Diver: description is staff-typed free text (the invoice form's own note
// Diver: field) and dropped for the same reason internal_notes and
// Diver: activity_events are — see the module docblock.
export const ORDERS_CSV = sharedFile<ShopRow<"orderRows">>({
  file: "orders.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => personName.get(row.personId),
    },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    { header: "created_by_person_id", in: "shop", value: (row) => row.createdByPersonId },
    {
      header: "created_by_name",
      in: "both",
      value: (row, { personName }) =>
        row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
    },
    { header: "source", in: "both", value: (row) => row.source },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "collection", in: "both", value: (row) => row.collection },
    { header: "currency", in: "both", value: (row) => row.currency },
    { header: "total_cents", in: "both", value: (row) => row.totalCents },
    { header: "pass_through_cents", in: "shop", value: (row) => row.passThroughCents },
    { header: "tax_cents", in: "shop", value: (row) => row.taxCents },
    { header: "amount_paid_cents", in: "both", value: (row) => row.amountPaidCents },
    { header: "refunded_cents", in: "both", value: (row) => row.refundedCents },
    { header: "description", in: "shop", value: (row) => row.description },
    { header: "stripe_invoice_id", in: "shop", value: (row) => row.stripeInvoiceId },
    { header: "hosted_invoice_url", in: "shop", value: (row) => row.hostedInvoiceUrl },
    { header: "invoice_pdf_url", in: "shop", value: (row) => row.invoicePdfUrl },
    { header: "finalized_at", in: "shop", value: (row) => row.finalizedAt },
    { header: "paid_at", in: "both", value: (row) => row.paidAt },
    { header: "voided_at", in: "shop", value: (row) => row.voidedAt },
    { header: "refunded_at", in: "both", value: (row) => row.refundedAt },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: { rows: ({ orderRows }) => orderRows, note: EXPORT_FILE_NOTES["orders.csv"] },
  diver: { rows: ({ orderRows }) => orderRows, note: "Orders this shop issued to this diver." },
});

// Diver: description is also staff-typed free text on this form; the same
// Diver: exclusion, same reason.
export const ORDER_LINE_ITEMS_CSV = sharedFile<ShopRow<"orderLineRows">>({
  file: "order_line_items.csv",
  columns: [
    { header: "order_id", in: "both", value: (row) => row.orderId },
    { header: "kind", in: "both", value: (row) => row.kind },
    { header: "description", in: "shop", value: (row) => row.description },
    { header: "quantity", in: "both", value: (row) => row.quantity },
    { header: "unit_amount_cents", in: "both", value: (row) => row.unitAmountCents },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ orderLineRows }) => orderLineRows,
    note: EXPORT_FILE_NOTES["order_line_items.csv"],
  },
  diver: {
    rows: ({ orderLineRows }) => orderLineRows,
    note: "The lines on each of this diver's orders.",
  },
});

export const TIPS_CSV = sharedFile<ShopRow<"tipRows">>({
  file: "tips.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    {
      header: "person_id",
      in: "shop",
      value: (row, { bookingPerson }) => bookingPerson.get(row.bookingId) ?? null,
    },
    {
      header: "person_name",
      in: "shop",
      value: (row, { bookingPerson, personName }) =>
        nameOf(personName, bookingPerson.get(row.bookingId)),
    },
    { header: "status", in: "both", value: (row) => row.status },
    { header: "currency", in: "both", value: (row) => row.currency },
    { header: "amount_cents", in: "both", value: (row) => row.amountCents },
    { header: "stripe_session_id", in: "shop", value: (row) => row.stripeSessionId },
    { header: "expires_at", in: "shop", value: (row) => row.expiresAt },
    { header: "completed_at", in: "both", value: (row) => row.completedAt },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: { rows: ({ tipRows }) => tipRows, note: EXPORT_FILE_NOTES["tips.csv"] },
  diver: {
    rows: ({ tipRows }) => tipRows,
    note: "Crew tips this diver started from their own post-trip recap page.",
  },
});

export const RECAP_PHOTOS_CSV = sharedFile<ShopRow<"recapPhotoRows">>({
  file: "recap_photos.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    { header: "trip_id", in: "shop", value: (row) => row.tripId },
    { header: "image_url", in: "both", value: (row) => row.imageUrl },
    { header: "caption", in: "both", value: (row) => row.caption },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ recapPhotoRows }) => recapPhotoRows,
    note: EXPORT_FILE_NOTES["recap_photos.csv"],
  },
  diver: {
    rows: ({ recapPhotoRows }) => recapPhotoRows,
    note: "Photos this diver attached to their own post-trip recap pages.",
  },
});

export const TRIP_REVIEWS_CSV = sharedFile<ShopRow<"reviewRows">>({
  file: "trip_reviews.csv",
  columns: [
    { header: "id", in: "both", value: ({ review }) => review.id },
    { header: "booking_id", in: "both", value: ({ review }) => review.bookingId },
    { header: "trip_id", in: "shop", value: ({ review }) => review.tripId },
    { header: "person_id", in: "shop", value: ({ review }) => review.personId },
    { header: "diver_name", in: "shop", value: ({ diverName }) => diverName },
    { header: "rating", in: "both", value: ({ review }) => review.rating },
    { header: "comment", in: "both", value: ({ review }) => review.comment },
    { header: "is_standout", in: "shop", value: ({ review }) => review.isStandout },
    { header: "is_published", in: "both", value: ({ review }) => review.isPublished },
    { header: "published_at", in: "both", value: ({ review }) => review.publishedAt },
    { header: "created_at", in: "both", value: ({ review }) => review.createdAt },
    { header: "updated_at", in: "shop", value: ({ review }) => review.updatedAt },
  ],
  shop: { rows: ({ reviewRows }) => reviewRows, note: EXPORT_FILE_NOTES["trip_reviews.csv"] },
  diver: {
    rows: ({ reviewRows, person }) =>
      reviewRows.map((review) => ({ review, diverName: person.fullName })),
    note: "This diver's own trip reviews.",
  },
});

export const REVIEW_MODERATION_EVENTS_CSV = sharedFile<{
  event: typeof reviewModerationEvents.$inferSelect;
  staffName: string | undefined;
}>({
  file: "review_moderation_events.csv",
  columns: [
    { header: "id", in: "both", value: ({ event }) => event.id },
    { header: "review_id", in: "both", value: ({ event }) => event.reviewId },
    { header: "action", in: "both", value: ({ event }) => event.action },
    { header: "reason", in: "both", value: ({ event }) => event.reason },
    { header: "reason_note", in: "both", value: ({ event }) => event.reasonNote },
    { header: "recorded_by_person_id", in: "shop", value: ({ event }) => event.recordedByPersonId },
    { header: "recorded_by_name", in: "both", value: ({ staffName }) => staffName },
    { header: "occurred_at", in: "both", value: ({ event }) => event.occurredAt },
  ],
  shop: {
    rows: ({ reviewModerationRows }) => reviewModerationRows,
    note: EXPORT_FILE_NOTES["review_moderation_events.csv"],
  },
  diver: {
    rows: ({ reviewModerationRows, personName }) =>
      reviewModerationRows.map((event) => ({
        event,
        staffName: personName.get(event.recordedByPersonId),
      })),
    note: "Every time staff published or hid one of this diver's reviews, and why.",
  },
});

export const DIVE_PACKAGE_ENTITLEMENTS_CSV = sharedFile<ShopRow<"entitlementRows">>({
  file: "dive_package_entitlements.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    {
      header: "package_name",
      in: "diver",
      value: (row, { packageName }) => packageName.get(row.packageId),
    },
    { header: "package_id", in: "shop", value: (row) => row.packageId },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    { header: "order_id", in: "shop", value: (row) => row.orderId },
    { header: "booking_id", in: "both", value: (row) => row.bookingId },
    { header: "consumed_at", in: "both", value: (row) => row.consumedAt },
    { header: "expires_at", in: "both", value: (row) => row.expiresAt },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: {
    rows: ({ entitlementRows }) => entitlementRows,
    note: EXPORT_FILE_NOTES["dive_package_entitlements.csv"],
  },
  diver: {
    rows: ({ entitlementRows }) => entitlementRows,
    note: "Prepaid dives this diver bought — spent and still owed.",
  },
});

export const COURSE_INQUIRIES_CSV = sharedFile<ShopRow<"inquiryRows">>({
  file: "course_inquiries.csv",
  columns: [
    { header: "id", in: "both", value: (row) => row.id },
    { header: "course_id", in: "shop", value: (row) => row.courseId },
    // Null for a request that names no course — it says what it is
    // about in `interest` instead, the column beside this one.
    {
      header: "course_title",
      in: "both",
      value: (row, { courseTitle }) => (row.courseId ? courseTitle.get(row.courseId) : null),
    },
    { header: "interest", in: "both", value: (row) => row.interest },
    { header: "person_id", in: "shop", value: (row) => row.personId },
    // Resolved at capture time by exact email match against a live
    // diver, never back-filled — so a null here is a lead nobody could
    // tie to a person, not a lookup this export skipped.
    {
      header: "person_name",
      in: "shop",
      value: (row, { personName }) => (row.personId ? personName.get(row.personId) : null),
    },
    { header: "name", in: "shop", value: (row) => row.name },
    { header: "email", in: "shop", value: (row) => row.email },
    { header: "phone", in: "shop", value: (row) => row.phone },
    { header: "experience_level", in: "both", value: (row) => row.experienceLevel },
    { header: "timing", in: "both", value: (row) => row.timing },
    { header: "preferred_date", in: "shop", value: (row) => row.preferredDate },
    { header: "alternate_date", in: "shop", value: (row) => row.alternateDate },
    { header: "date_flexible", in: "shop", value: (row) => row.dateFlexible },
    { header: "divers", in: "shop", value: (row) => row.divers },
    { header: "message", in: "both", value: (row) => row.message },
    { header: "created_at", in: "both", value: (row) => row.createdAt },
  ],
  shop: { rows: ({ inquiryRows }) => inquiryRows, note: EXPORT_FILE_NOTES["course_inquiries.csv"] },
  diver: {
    rows: ({ inquiryRows }) => inquiryRows,
    note: "Course leads this diver submitted through the shop's public page.",
  },
});
