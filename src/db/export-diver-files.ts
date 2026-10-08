import type { DiverExportContext } from "./export";
import type { ExportFileSpec } from "./export-tables";

/**
 * **One diver's own bundle, file by file** (ADR 20260824-diver-record-export):
 * every CSV `loadDiverExportBundleInput` writes, in bundle order. The same
 * tables as the shop bundle, read by the diver's person id or their bookings,
 * but **not the same files**: each one here is shaped for a subject-access
 * answer — other people appear by name where the diver needs to know who, and
 * not at all where the row is shared (the decisions are written above
 * `loadDiverExportBundleInput` in `./export`). That is why these entries are
 * not the shop's entries filtered: a shop file reused here would hand a diver
 * another diver's foreign keys and staff-only columns.
 */

export const DIVER_EXPORT_FILES: ExportFileSpec<DiverExportContext>[] = [
  {
    file: "profile.csv",
    header: [
      "id",
      "full_name",
      "email",
      "phone",
      "date_of_birth",
      "dive_insurance",
      "emergency_contact_name",
      "emergency_contact_phone",
      "courtesy_email_opt_out_at",
      "no_certification_declared_at",
      "no_certification_cleared_at",
      "adult_attested_at",
      "deleted_at",
      "created_at",
    ],
    rows: ({ person }) => [
      [
        person.id,
        person.fullName,
        person.email,
        person.phone,
        person.dateOfBirth,
        person.diveInsurance,
        person.emergencyContactName,
        person.emergencyContactPhone,
        person.courtesyEmailOptOutAt,
        person.noCertificationDeclaredAt,
        person.noCertificationClearedAt,
        person.adultAttestedAt,
        person.deletedAt,
        person.createdAt,
      ],
    ],
    note: "This diver's own contact and profile record.",
  },
  {
    file: "certifications.csv",
    header: [
      "id",
      "agency",
      "level",
      "identifier",
      "declared_identifier",
      "status",
      "review_note",
      "reviewed_at",
      "reviewed_by_name",
      "imported_at",
      "imported_from_label",
      "self_declared_at",
      "deleted_at",
      "created_at",
    ],
    rows: ({ personName, certificationRows }) =>
      certificationRows.map((row) => [
        row.id,
        row.agency,
        row.level,
        row.identifier,
        row.declaredIdentifier,
        row.status,
        row.reviewNote,
        row.reviewedAt,
        row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
        row.importedAt,
        row.importedFromLabel,
        row.selfDeclaredAt,
        row.deletedAt,
        row.createdAt,
      ]),
    note: "Certification records this shop holds on file, with their verification status.",
  },
  {
    file: "specialty_certifications.csv",
    header: [
      "id",
      "agency",
      "specialty",
      "identifier",
      "status",
      "review_note",
      "reviewed_at",
      "reviewed_by_name",
      "deleted_at",
      "created_at",
    ],
    rows: ({ personName, specialtyRows }) =>
      specialtyRows.map((row) => [
        row.id,
        row.agency,
        row.specialty,
        row.identifier,
        row.status,
        row.reviewNote,
        row.reviewedAt,
        row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
        row.deletedAt,
        row.createdAt,
      ]),
    note: "Specialty certifications (deep, wreck, night, drysuit) with their verification status.",
  },
  {
    file: "nitrox_certifications.csv",
    header: [
      "id",
      "agency",
      "identifier",
      "status",
      "review_note",
      "reviewed_at",
      "reviewed_by_name",
      "imported_at",
      "imported_from_label",
      "self_declared_at",
      "deleted_at",
      "created_at",
    ],
    rows: ({ personName, nitroxRows }) =>
      nitroxRows.map((row) => [
        row.id,
        row.agency,
        row.identifier,
        row.status,
        row.reviewNote,
        row.reviewedAt,
        row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
        row.importedAt,
        row.importedFromLabel,
        row.selfDeclaredAt,
        row.deletedAt,
        row.createdAt,
      ]),
    note: "Nitrox (EANx) certification with its verification status.",
  },
  {
    file: "bookings.csv",
    header: [
      "id",
      "trip_title",
      "trip_starts_at",
      "status",
      "participant_type",
      "booked_as",
      "wants_nitrox",
      "conditions_briefed_at",
      "dive_intent",
      "re_entry_ask",
      "last_dived_band",
      "claimed_at",
      "payment_status",
      "payment_amount_cents",
      "payment_currency",
      "payment_provider",
      "created_at",
    ],
    rows: ({ bookingRows, tripTitle, tripStartsAt, paymentByBooking }) =>
      bookingRows.map((row) => {
        const payment = paymentByBooking.get(row.id);
        return [
          row.id,
          tripTitle.get(row.tripId),
          tripStartsAt.get(row.tripId),
          row.status,
          row.participantType,
          row.bookedAs,
          row.wantsNitrox,
          row.conditionsBriefedAt,
          row.diveIntent,
          row.reEntryAsk,
          row.lastDivedBand,
          row.claimedAt,
          payment?.status ?? "unpaid",
          payment?.amountCents,
          payment?.currency,
          payment?.provider,
          row.createdAt,
        ];
      }),
    // party_lead_booking_id is deliberately not a column here: on a
    // shared booking it is another diver's booking id, and it is a
    // foreign key this diver has no reason to hold — see the module
    // docblock's shared-row decisions.
    note: "Every booking this diver has held at this shop, with its current payment state.",
  },
  {
    file: "waitlist_entries.csv",
    header: ["id", "trip_title", "trip_starts_at", "invited_at", "created_at"],
    rows: ({ tripTitle, tripStartsAt, waitlistRows }) =>
      waitlistRows.map((row) => [
        row.id,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.invitedAt,
        row.createdAt,
      ]),
    note: "Full trips this diver joined the wait list for.",
  },
  {
    file: "trip_invitations.csv",
    header: ["id", "trip_title", "trip_starts_at", "source", "invited_at", "created_at"],
    rows: ({ tripTitle, tripStartsAt, invitationRows }) =>
      invitationRows.map((row) => [
        row.id,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.source,
        row.invitedAt,
        row.createdAt,
      ]),
    note: "Staff outreach inviting this diver to a departure without claiming a seat.",
  },
  {
    file: "last_minute_list.csv",
    header: ["id", "available_from", "available_until", "unsubscribed_at", "created_at"],
    rows: ({ lastMinuteListRows }) =>
      lastMinuteListRows.map((row) => [
        row.id,
        row.availableFrom,
        row.availableUntil,
        row.unsubscribedAt,
        row.createdAt,
      ]),
    note: "This diver's opt-in to hear about last-minute deals shop-wide, and the date range they gave.",
  },
  {
    file: "trip_last_minute_promo_recipients.csv",
    header: ["id", "trip_promo_id", "email", "created_at"],
    rows: ({ lastMinutePromoRecipientRows }) =>
      lastMinutePromoRecipientRows.map((row) => [
        row.id,
        row.tripPromoId,
        row.email,
        row.createdAt,
      ]),
    note: "Last-minute deal blasts this diver was sent.",
  },
  {
    file: "booking_payment_events.csv",
    header: [
      "id",
      "booking_id",
      "status",
      "previous_status",
      "amount_cents",
      "currency",
      "provider",
      "operation",
      "occurred_at",
    ],
    rows: ({ paymentEventRows }) =>
      paymentEventRows.map((row) => [
        row.id,
        row.bookingId,
        row.status,
        row.previousStatus,
        row.amountCents,
        row.currency,
        row.provider,
        row.operation,
        row.occurredAt,
      ]),
    note: "Every recorded change to this diver's payment state, oldest first.",
  },
  {
    file: "booking_checkout_bookings.csv",
    header: ["checkout_id", "booking_id", "trip_cents", "gear_cents"],
    rows: ({ checkoutBookingRows }) =>
      checkoutBookingRows.map((row) => [
        row.checkoutId,
        row.bookingId,
        row.tripCents,
        row.gearCents,
      ]),
    // The checkout attempt itself (booking_checkouts.csv in the shop
    // bundle) is not included: one attempt can cover a whole party
    // sharing a single Stripe session, so its customer_email and totals
    // may not be this diver's — see the module docblock. This is only
    // this diver's own seat within any such attempt.
    note: "Rental gear charged on this diver's own seat within a checkout attempt.",
  },
  {
    file: "booking_arrival_events.csv",
    header: [
      "id",
      "trip_title",
      "trip_starts_at",
      "booking_id",
      "status",
      "source",
      "recorded_by_name",
      "occurred_at",
    ],
    rows: ({ tripTitle, tripStartsAt, personName, arrivalRows }) =>
      arrivalRows.map((row) => [
        row.id,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.bookingId,
        row.status,
        row.source,
        personName.get(row.recordedByPersonId),
        row.occurredAt,
      ]),
    note: "When this diver was checked in at the counter, and when that was taken back. Arriving is not boarding — that is roll_call_events.csv.",
  },
  {
    file: "roll_call_events.csv",
    header: [
      "id",
      "trip_title",
      "trip_starts_at",
      "booking_id",
      "status",
      "checkpoint",
      "recorded_by_name",
      "occurred_at",
    ],
    rows: ({ tripTitle, tripStartsAt, personName, rollCallRows }) =>
      rollCallRows.map((row) => [
        row.id,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.bookingId,
        row.status,
        row.checkpoint,
        personName.get(row.recordedByPersonId),
        row.occurredAt,
      ]),
    // `note` (a free-text field staff can type at the rail) is
    // deliberately not a column here — see activity_events in "Not
    // included": free text on this table can name a different diver, and
    // safely redacting it needs the same sweep the erasure path uses.
    note: "This diver's own boarding and roll-call record.",
  },
  {
    file: "buddy_pairs.csv",
    header: [
      "pair_id",
      "trip_title",
      "trip_starts_at",
      "member_kind",
      "paired_by_name",
      "created_at",
    ],
    rows: ({ tripTitle, tripStartsAt, personName, buddyPairRows }) =>
      buddyPairRows.map((row) => [
        row.pairId,
        tripTitle.get(row.tripId),
        tripStartsAt.get(row.tripId),
        row.bookingId ? "diver" : "crew",
        personName.get(row.pairedByPersonId),
        row.createdAt,
      ]),
    // Only this diver's own membership row per team: filtered to their
    // own bookings/crew id, so another member's row is never selected in
    // the first place — see the module docblock.
    note: "Buddy teams this diver was recorded on. Other members are not named here.",
  },
  {
    file: "waiver_templates.csv",
    header: ["id", "title", "version", "body"],
    // waiverRecords.templateBody is the text as signed — a snapshot at
    // signing time, never the live waiverTemplates row, which a shop can
    // go on editing after this diver signed. One row per distinct
    // template this diver actually agreed to.
    rows: ({ waiverRows }) =>
      (() => {
        const templateIds = [...new Set(waiverRows.map((row) => row.templateId))];
        return templateIds.map((id) => {
          const row = waiverRows.find((waiver) => waiver.templateId === id);
          return [id, row?.templateTitle, row?.templateVersion, row?.templateBody];
        });
      })(),
    note: "The exact wording of each release this diver signed, by version, as it read the moment they signed it.",
  },
  {
    file: "waiver_records.csv",
    header: [
      "id",
      "booking_id",
      "template_title",
      "template_version",
      "status",
      "signed_name",
      "signature_method",
      "recorded_by_name",
      "started_at",
      "consented_at",
      "signed_at",
      "completed_at",
      "medical_review_required",
      // The clearance is the diver's own fact — a physician evaluated
      // them and the shop recorded it — so it belongs in their bundle
      // even though the answers behind it do not. The staff member who
      // recorded it is named for the same reason `recorded_by_name` is.
      "medical_cleared_at",
      "medical_cleared_by_name",
      // And the refusal (issue #1283), which is the diver's own fact more
      // plainly than the clearance is: it is the finding that kept them
      // off a boat, and a subject-access bundle that withheld it would be
      // hiding from somebody the one record they are most entitled to.
      "medical_clearance_declined_at",
      "medical_clearance_declined_by_name",
      "medical_clearance_evaluated_on",
      "medical_clearance_physician_name",
      // Who co-signed, when the diver was a minor: the guardian's name
      // and email are a third party's personal data, but they are on
      // *this diver's* release, which is the record the subject-access
      // bundle exists to hand over whole (ADR 20260907-guardian-co-signature).
      "guardian_name",
      "guardian_relationship",
      "guardian_email",
      "guardian_signature_method",
      "guardian_consented_at",
      "guardian_signed_at",
      "superseded_at",
      "expires_at",
      "created_at",
    ],
    // medical_answers is deliberately absent — see the module docblock.
    rows: ({ personName, waiverRows }) =>
      waiverRows.map((row) => [
        row.id,
        row.bookingId,
        row.templateTitle,
        row.templateVersion,
        row.status,
        row.signedName,
        row.signatureMethod,
        row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
        row.startedAt,
        row.consentedAt,
        row.signedAt,
        row.completedAt,
        row.medicalReviewRequired,
        row.medicalClearedAt,
        row.medicalClearedByPersonId ? personName.get(row.medicalClearedByPersonId) : null,
        row.medicalClearanceDeclinedAt,
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
        row.supersededAt,
        row.expiresAt,
        row.createdAt,
      ]),
    note: "Waiver evidence this diver signed. Medical answers are withheld pending a legal review of subject-access scope (docs/product/human-decisions.md).",
  },
  {
    file: "rental_fit.csv",
    header: [
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
      "updated_at",
    ],
    rows: ({ rentalFitRows }) =>
      rentalFitRows.map((row) => [
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
        row.updatedAt,
      ]),
    note: "This diver's rental kit and sizes on file.",
  },
  {
    file: "gear_reservations.csv",
    header: [
      "id",
      "gear_item_label",
      "booking_id",
      "person_id",
      "reserved_from",
      "reserved_until",
      "checked_out_at",
      "returned_at",
      "created_at",
    ],
    rows: ({ gearReservationRows, gearItemLabel }) =>
      gearReservationRows.map((row) => [
        row.id,
        gearItemLabel.get(row.gearItemId),
        row.bookingId,
        row.personId,
        row.reservedFrom,
        row.reservedUntil,
        row.checkedOutAt,
        row.returnedAt,
        row.createdAt,
      ]),
    note: "Rental gear reserved for this diver's own seats.",
  },
  {
    file: "prior_visits.csv",
    header: [
      "id",
      "visited_on",
      "title",
      "status_label",
      "amount_label",
      "source_label",
      "imported_at",
    ],
    rows: ({ priorVisitRows }) =>
      priorVisitRows.map((row) => [
        row.id,
        row.visitedOn,
        row.title,
        row.statusLabel,
        row.amountLabel,
        row.sourceLabel,
        row.importedAt,
      ]),
    note: "Visit history the shop imported from its previous system for this diver.",
  },
  {
    file: "imported_payment_history.csv",
    header: [
      "id",
      "occurred_on",
      "direction",
      "title",
      "status_label",
      "amount_label",
      "amount_cents",
      "currency",
      "imported_at",
    ],
    rows: ({ importedPaymentHistoryRows }) =>
      importedPaymentHistoryRows.map((row) => [
        row.id,
        row.occurredOn,
        row.direction,
        row.title,
        row.statusLabel,
        row.amountLabel,
        row.amountCents,
        row.currency,
        row.importedAt,
      ]),
    note: "Payment source history the shop imported from its previous system for this diver.",
  },
  {
    file: "notification_deliveries.csv",
    header: ["id", "booking_id", "kind", "status", "provider_status", "attempted_at"],
    rows: ({ notificationRows }) =>
      notificationRows.map((row) => [
        row.id,
        row.bookingId,
        row.kind,
        row.status,
        row.providerStatus,
        row.attemptedAt,
      ]),
    note: "Whether this diver actually got each message the shop sent them — confirmation, waiver request, reminder, recap.",
  },
  {
    file: "orders.csv",
    header: [
      "id",
      "booking_id",
      "created_by_name",
      "status",
      "currency",
      "total_cents",
      "amount_paid_cents",
      "refunded_cents",
      "paid_at",
      "refunded_at",
      "created_at",
    ],
    // description is staff-typed free text (the invoice form's own note
    // field) and dropped for the same reason internal_notes and
    // activity_events are — see the module docblock.
    rows: ({ personName, orderRows }) =>
      orderRows.map((row) => [
        row.id,
        row.bookingId,
        row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
        row.status,
        row.currency,
        row.totalCents,
        row.amountPaidCents,
        row.refundedCents,
        row.paidAt,
        row.refundedAt,
        row.createdAt,
      ]),
    note: "Orders this shop issued to this diver.",
  },
  {
    file: "order_line_items.csv",
    header: ["order_id", "kind", "quantity", "unit_amount_cents", "created_at"],
    // description is also staff-typed free text on this form; the same
    // exclusion, same reason.
    rows: ({ orderLineRows }) =>
      orderLineRows.map((row) => [
        row.orderId,
        row.kind,
        row.quantity,
        row.unitAmountCents,
        row.createdAt,
      ]),
    note: "The lines on each of this diver's orders.",
  },
  {
    file: "tips.csv",
    header: [
      "id",
      "booking_id",
      "status",
      "currency",
      "amount_cents",
      "completed_at",
      "created_at",
    ],
    rows: ({ tipRows }) =>
      tipRows.map((row) => [
        row.id,
        row.bookingId,
        row.status,
        row.currency,
        row.amountCents,
        row.completedAt,
        row.createdAt,
      ]),
    note: "Crew tips this diver started from their own post-trip recap page.",
  },
  {
    file: "recap_photos.csv",
    header: ["id", "booking_id", "image_url", "caption", "created_at"],
    rows: ({ recapPhotoRows }) =>
      recapPhotoRows.map((row) => [
        row.id,
        row.bookingId,
        row.imageUrl,
        row.caption,
        row.createdAt,
      ]),
    note: "Photos this diver attached to their own post-trip recap pages.",
  },
  {
    file: "trip_reviews.csv",
    header: ["id", "booking_id", "rating", "comment", "is_published", "published_at", "created_at"],
    rows: ({ reviewRows }) =>
      reviewRows.map((row) => [
        row.id,
        row.bookingId,
        row.rating,
        row.comment,
        row.isPublished,
        row.publishedAt,
        row.createdAt,
      ]),
    note: "This diver's own trip reviews.",
  },
  {
    file: "review_moderation_events.csv",
    header: [
      "id",
      "review_id",
      "action",
      "reason",
      "reason_note",
      "recorded_by_name",
      "occurred_at",
    ],
    rows: ({ personName, reviewModerationRows }) =>
      reviewModerationRows.map((row) => [
        row.id,
        row.reviewId,
        row.action,
        row.reason,
        row.reasonNote,
        personName.get(row.recordedByPersonId),
        row.occurredAt,
      ]),
    note: "Every time staff published or hid one of this diver's reviews, and why.",
  },
  {
    file: "dive_package_entitlements.csv",
    header: ["id", "package_name", "booking_id", "consumed_at", "expires_at", "created_at"],
    rows: ({ entitlementRows, packageName }) =>
      entitlementRows.map((row) => [
        row.id,
        packageName.get(row.packageId),
        row.bookingId,
        row.consumedAt,
        row.expiresAt,
        row.createdAt,
      ]),
    note: "Prepaid dives this diver bought — spent and still owed.",
  },
  {
    file: "course_inquiries.csv",
    header: [
      "id",
      "course_title",
      "interest",
      "experience_level",
      "timing",
      "message",
      "created_at",
    ],
    rows: ({ inquiryRows, courseTitle }) =>
      inquiryRows.map((row) => [
        row.id,
        row.courseId ? courseTitle.get(row.courseId) : null,
        row.interest,
        row.experienceLevel,
        row.timing,
        row.message,
        row.createdAt,
      ]),
    note: "Course leads this diver submitted through the shop's public page.",
  },
];
