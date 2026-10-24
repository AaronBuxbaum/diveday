import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CERTIFICATION_AGENCIES } from "@/lib/certification-options";
import { DESK_PAYMENTS } from "@/lib/desk-payment";
import type { EmergencyReference } from "@/lib/emergency-reference";
import { DEFAULT_SHOP_RENTAL_ITEMS, type RentalPricing } from "@/lib/rentals";
import type { SpokenLanguageTag } from "@/lib/spoken-languages";
import { appNowTimestamp } from "./columns";

/**
 * The tenant and the person: `shops`, `people` and their roles, the login on
 * `user_accounts`, and the enums several domains share (units, certification
 * agency/level/status, specialties).
 */

/** Selects which diver medical questionnaire a shop presents (src/lib/medical.ts). */
export const medicalJurisdiction = pgEnum("medical_jurisdiction", ["rstc", "uk"]);

/** How a shop reads depth. Storage stays metres either way (src/lib/depth-units.ts). */
export const depthUnit = pgEnum("depth_unit", ["meters", "feet"]);

/**
 * The six display faces a shop may choose for its storefront's headings
 * (ADR 20260901-diveday-reimagined, decision 2 — Harbor). A closed list rather
 * than free text because the storefront has to be able to *load* the face, and
 * because a face is a claim about the shop's brand that has to arrive intact in
 * every language. The words for each live in `src/lib/brand.ts`, which owns the
 * Google family and fallback stack per code; null means the shop wears Geist.
 */
export const brandDisplayFont = pgEnum("brand_display_font", [
  "bricolage_grotesque",
  "outfit",
  "sora",
  "playfair_display",
  "archivo_black",
  "lora",
]);

/**
 * How a shop reads water temperature. Storage stays Celsius either way
 * (src/lib/temperature-units.ts).
 */
export const temperatureUnit = pgEnum("temperature_unit", ["celsius", "fahrenheit"]);

/** How a shop takes money at the desk (src/lib/desk-payment.ts). */
export const deskPayment = pgEnum("desk_payment", DESK_PAYMENTS);

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** IANA timezone of the physical shop — all schedule display uses this. */
    timezone: text("timezone").notNull(),
    /** BCP 47 locale for public and capability-page copy/formatting. */
    defaultLocale: text("default_locale").notNull().default("en-US"),
    /**
     * ISO 4217 currency (lowercase, Stripe's spelling) for every amount this
     * shop displays or charges — the single source of truth, chosen in
     * settings (docs ADR 20260731-shop-currency). All `*_cents` columns hold
     * this currency's **minor unit**, which is not always 1/100: a zero-decimal
     * currency like JPY stores whole yen, so display divides by the currency's
     * own exponent rather than a hardcoded 100 (`src/lib/money.ts`).
     *
     * `shop_stripe_accounts.default_currency` is what Stripe *reports* for the
     * connected account and stays advisory: settings surfaces a mismatch
     * rather than silently overriding what the shop declared here.
     */
    currency: text("currency").notNull().default("usd"),
    /** Whether new Stripe charges should calculate and collect tax. Off by default. */
    taxEnabled: boolean("tax_enabled").notNull().default(false),
    /** Optional shop-configured conservation/park fee passed through per diver. */
    passThroughFee: jsonb("pass_through_fee")
      .$type<{ name: string; amountCents: number } | null>()
      .default(null),
    /** Which medical questionnaire the shop's waivers use; RSTC is the default. */
    jurisdiction: medicalJurisdiction("jurisdiction").notNull().default("rstc"),
    /**
     * Whether this shop reads depths in metres or feet. Display and entry only —
     * `dive_sites.max_depth_meters` is always canonical metres, so switching the
     * unit reinterprets nothing and no stored number ever moves. Metres is the
     * default because the agency standards DiveDay encodes are stated in metres
     * (20260724-course-admission-standards); a US shop flips it once in settings.
     */
    depthUnit: depthUnit("depth_unit").notNull().default("meters"),
    /**
     * Whether this shop reads water temperature in Celsius or Fahrenheit.
     * Display and entry only — `trips.water_temperature_c` is always canonical
     * Celsius, so switching the unit reinterprets nothing and no stored number
     * ever moves, exactly like `depth_unit` above.
     *
     * Its own column rather than a reading of `depth_unit`, which is what
     * src/lib/temperature-units.ts derived before this existed: the two
     * genuinely come apart. A UK shop dives in metres and talks about the water
     * in Celsius; a US shop does feet and Fahrenheit; but plenty of shops in
     * between (Caribbean operators serving American divers, for one) publish
     * feet *and* Celsius, and had no way to say so. Celsius is the default
     * because storage is Celsius and most of the diving world reads it; the
     * migration that added this column backfilled Fahrenheit for shops already
     * set to feet, so no existing shop's reading changed on the day it landed.
     */
    temperatureUnit: temperatureUnit("temperature_unit").notNull().default("celsius"),
    /**
     * **Boat diving is the default because the product was built assuming it.**
     * `trips.dive_mode` still defaults to `boat`, the schedule builder still
     * opens on it, and a shop that never touches this settings row keeps the
     * behaviour it had — which is why this column defaults true where its two
     * siblings default false.
     *
     * Turning it off is a real statement: a shore-and-pool operation has no
     * hull, so the Boats row disappears from settings, `boat` leaves the
     * builder's dive-mode choices, and the Requests planner stops sizing a day
     * against a boat it does not have (`src/lib/request-advisor.ts`). It does
     * **not** rewrite departures already on the board — an existing boat trip
     * keeps its mode and still renders, because a settings tick is not a
     * schedule edit.
     */
    hasBoatDiving: boolean("has_boat_diving").notNull().default(true),
    hasShoreDiving: boolean("has_shore_diving").notNull().default(false),
    hasPoolDiving: boolean("has_pool_diving").notNull().default(false),
    /**
     * The shop's target diver-to-divemaster ratio, stored as the divers half:
     * `5` is "5:1". It applies to every dive the shop runs, fun dives and
     * course sessions alike, and it binds nothing — DiveDay shows a departure
     * against it and sizes a day's requests by it, and refuses nothing
     * (`src/lib/divemaster-ratio.ts`).
     *
     * Not null, because every suggestion needs a number and a null would only
     * be a second spelling of the default. A shop that has never opened the
     * settings row runs at `DEFAULT_DIVERS_PER_DIVEMASTER`, which is visible
     * and editable there rather than hidden in a fallback.
     *
     * It replaced `shore_group_size` ("Divers per departure"), which only a
     * boatless shop was asked for and only the Requests planner read (ADR
     * 20260820-shop-divemaster-ratio).
     */
    diversPerDivemaster: integer("divers_per_divemaster").notNull().default(6),
    /**
     * **Whether the shop plans its crew in DiveDay** — the Crew view of
     * Schedule (shifts, days away, crew asking for a departure), the crew line
     * on the week, and every nudge measured against `divers_per_divemaster`.
     * Off by default: a two-person shop where the owner skippers every boat
     * has no roster to keep, and a page of empty rows and "No crew" warnings
     * is noise it would have to learn to ignore (ADR 20261005-crew-schedule-is-a-setting).
     * **Amended 2026-10-23 (Aaron): on for a new shop**, like every switch on
     * the Features page; a shop that keeps no roster turns it off there.
     *
     * Off never loosens a safety cap. A course session still names its
     * instructor on the trip page, because the agency training ratio refuses
     * seats from that count (`src/lib/course-ratios.ts`) whatever this says.
     */
    crewScheduleEnabled: boolean("crew_schedule_enabled").notNull().default(true),
    /**
     * **Optional features a shop can switch off** (ADR
     * 20261005-optional-shop-features). Each defaults on, so a new shop sees
     * what every shop saw before the switch existed; off hides the feature on
     * every surface and deletes nothing. The rule for what each hides lives in
     * `src/lib/shop-features.ts`.
     *
     * - `reviews_enabled`: DiveDay's own star ratings — the recap's rating
     *   form, the public reviews page and every published star. The shop's
     *   own `review_url` keeps working either way.
     * - `date_requests_enabled`: "ask for a day" on the shopfront. A course
     *   page's own inquiry is not one and stays.
     * - `last_minute_list_enabled`: the shopfront's last-minute sign-up and the
     *   trip page's deal sender.
     * - `tips_enabled`: the tip on the recap. Tipping is a custom in some
     *   waters and an awkward ask in others.
     */
    reviewsEnabled: boolean("reviews_enabled").notNull().default(true),
    dateRequestsEnabled: boolean("date_requests_enabled").notNull().default(true),
    lastMinuteListEnabled: boolean("last_minute_list_enabled").notNull().default(true),
    tipsEnabled: boolean("tips_enabled").notNull().default(true),
    /**
     * **"Our year" on the public schedule**: the Reports year card's counts
     * (divers, boats out, sites) at the foot of the shopfront. Counts only,
     * never money (`src/db/public-year.ts`). It defaulted off from 2026-10-11
     * (the shop opted in to publishing its own counts); since 2026-10-23 every
     * feature starts on for a new shop (Aaron), and the shop turns it off on
     * the Features page.
     */
    publicYearEnabled: boolean("public_year_enabled").notNull().default(true),
    /**
     * **PADI checks (beta)**: "Check with PADI" (DiveChek) on a pending PADI
     * card and the PADI eLearning check on a course roster, both run by the
     * DiveDay extension in a staffer's browser signed in to the PADI Pros'
     * Site under the shop's own membership (H-121, H-106). On for a new shop
     * since 2026-10-23 (Aaron, amending H-121's opt-in): a shop whose Pros do
     * not want it turns it off on the Features page. Off keeps the "(member
     * sign-in)" link (`src/lib/agency-check.ts`).
     */
    padiChecksEnabled: boolean("padi_checks_enabled").notNull().default(true),
    /**
     * **Claude suggestions**: the drafts, sorting and reading Claude offers
     * staff across the app (ADR 20261018-claude-assists). On by default; off,
     * every assist is dark and each feature works exactly as it does without
     * Claude. Nothing an assist wrote is deleted by turning it off.
     */
    claudeSuggestionsEnabled: boolean("claude_suggestions_enabled").notNull().default(true),
    /**
     * **Recap highlights without a tap** (the `recap` assist): when a
     * departure's recap goes out and the crew left its note empty, Claude's
     * two-sentence highlight from the logged sightings fills it. On for a new
     * shop since 2026-10-23 (Aaron: every feature starts on); off, a crew
     * approves each one by saving it.
     */
    recapAssistAutoApprove: boolean("recap_assist_auto_approve").notNull().default(true),
    /**
     * **Lost and found**: the register of what crews found aboard, its Today
     * row, the boat's and arrival desk's found-item panels, and the "we found
     * your …" email. On by default (ADR 20261005-optional-shop-features,
     * amended 2026-10-23); off hides every door and deletes no item.
     */
    lostFoundEnabled: boolean("lost_found_enabled").notNull().default(true),
    /**
     * **Gear servicing (work orders)**: the bench, its Today rows, a diver's
     * work orders and the customer service reminders and emails. Off hides it
     * all and deletes no ticket; the rental fleet's own service clocks stay,
     * because they are safety.
     */
    workOrdersEnabled: boolean("work_orders_enabled").notNull().default(true),
    /**
     * **Promo codes**: the Money tab and the code box a diver types into. Off,
     * no code redeems; a last-minute deal's code still does while the
     * last-minute list is on.
     */
    promoCodesEnabled: boolean("promo_codes_enabled").notNull().default(true),
    /**
     * **Dive packages**: selling prepaid dives (the staff packages view, the
     * shopfront's packages page). Off stops selling only: a diver's balance
     * already paid for still redeems.
     */
    divePackagesEnabled: boolean("dive_packages_enabled").notNull().default(true),
    /**
     * **Abandoned-checkout emails**: the one nudge a diver gets when a
     * booking's payment was started and never finished. Off, the cron sends
     * none; the unpaid booking itself is untouched.
     */
    checkoutRecoveryEnabled: boolean("checkout_recovery_enabled").notNull().default(true),
    /**
     * **Bring a buddy**: the share link on a diver's ready page and recap, the
     * credit a booking through it earns, and the referred-seats lines on
     * Reports and the diver's record. Off hides the link and records no new
     * credit; credits already earned stay.
     */
    buddyLinksEnabled: boolean("buddy_links_enabled").notNull().default(true),
    /**
     * **Marine-life sightings**: what the crew saw on a dive (the manifest's
     * "Seen" group and the dive log's species), the shopfront's month shelf,
     * a trip page's recent sightings and the recap's field guide. Off hides
     * every one and erases no sighting; roll call and head count never change.
     */
    sightingsEnabled: boolean("sightings_enabled").notNull().default(true),
    /**
     * **Recap photos**: divers and crew adding photos to a departure's recap.
     * Off, no upload is taken and the recap shows no album; photos already
     * added stay visible to staff so one can still be taken down, and media
     * deletions keep running.
     */
    diverPhotosEnabled: boolean("diver_photos_enabled").notNull().default(true),
    /**
     * **Counter QR self-registration**: the printed counter card and the
     * public sign-up page it opens. Off, the page is gone and the card leaves
     * Settings; divers who already signed themselves up stay.
     */
    selfRegistrationEnabled: boolean("self_registration_enabled").notNull().default(true),
    /**
     * **Waitlist**: a diver asking to hear when a seat opens on a full
     * departure (the public join, the staff doors that add someone to it) and
     * the list's own seat offers (the nightly roll's invite, the "Who wants
     * in" offer). Off, nobody new joins and the list sends nothing; divers
     * already waiting stay on the panel and Today until someone handles them,
     * a staffer may still email any diver a date themselves, and the roll
     * still moves sailed interests.
     */
    waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
    /**
     * **Invite past divers**: suggestions to invite divers who sailed before
     * onto a thin boat, the quiet-day invite door, and the seat offer a
     * suggestion sends. Off, nobody is suggested and a suggestion's invite is
     * refused; an invite a staffer picks themselves (the roster's Invite, the
     * course ladder, the no-show desk) is not a suggestion and still sends.
     */
    pastDiverInvitesEnabled: boolean("past_diver_invites_enabled").notNull().default(true),
    /**
     * **Day-of help requests**: a diver asking the crew for help from their
     * ready page, and Today's row for it. Off, no new request is taken and the
     * ready page shows the shop's contact instead; a request already open
     * stays on Today until the crew handles it, and its diver may withdraw it.
     */
    helpRequestsEnabled: boolean("help_requests_enabled").notNull().default(true),
    /**
     * **Partner links**: referral links for a hotel or partner, the credit a
     * booking through one earns and Reports' referred seats. Off, the embed
     * page offers none and no new credit is recorded; earlier credits stay.
     */
    partnerLinksEnabled: boolean("partner_links_enabled").notNull().default(true),
    /**
     * **Week-out reminder**: the email a diver gets seven days before a
     * departure. Off, the plain "see you next week" hello is not sent; a diver
     * with anything still on their checklist or course materials due still
     * gets it, and the day-before reminder always sends.
     */
    weekOutReminderEnabled: boolean("week_out_reminder_enabled").notNull().default(true),
    /**
     * **Public conditions**: the automated marine outlook on a public trip
     * page, shown when the crew has written no read of their own. Off, no
     * outlook is fetched or shown; the crew's own read, their conditions
     * updates in the change ledger, the "changed since you booked" notice, the
     * staff conditions panel and the high-wind alert never change.
     */
    publicConditionsEnabled: boolean("public_conditions_enabled").notNull().default(true),
    /**
     * **Field guide**: the species picked for each dive site, shown on its
     * public page, trip briefings, the recap and the manifest's species
     * shortlist. Off, it is hidden and kept (a site save writes none of it);
     * the sites themselves stay.
     */
    fieldGuideEnabled: boolean("field_guide_enabled").notNull().default(true),
    /**
     * Where a diver who is not booking yet should write. Published on public
     * pages, so it is the shop's front-desk address rather than an owner's
     * personal one — nullable because a shop that has not chosen one must not
     * have a member of staff's address guessed on its behalf.
     */
    contactEmail: text("contact_email"),
    /**
     * When the shop proved it controls `contactEmail`, by opening the link a
     * confirmation email sent there (ADR 20260902-sender-standards-for-ses,
     * amended). Null until then, and cleared by any change to the address:
     * the address is the thing being vouched for, so a new one starts
     * unconfirmed. Only a confirmed address becomes `Reply-To` on diver mail
     * -- an unconfirmed one is still published on the public pages exactly as
     * before, which is a diver choosing to write to it, not DiveDay routing
     * a diver's reply there (issue #1288).
     */
    contactEmailConfirmedAt: timestamp("contact_email_confirmed_at", { withTimezone: true }),
    /**
     * The token in this shop's inbound reply address —
     * `reply+<token>@<inbound domain>` is the `Reply-To` on every email the
     * shop sends through DiveDay, so a diver who hits reply lands in the
     * shop's own inbox rather than a dead letter box (ADR
     * 20260907-two-way-inbox). Unguessable and unique, minted by the database
     * on insert; never shown to a person and never typed. Attribution is by
     * the token alone: the receiving route resolves it to the shop and only
     * then matches the sender's address to a diver inside that shop.
     */
    inboundEmailToken: uuid("inbound_email_token").notNull().defaultRandom(),
    contactPhone: text("contact_phone"),
    /**
     * Where a post-trip review request sends a diver — a Google Business,
     * TripAdvisor, or Facebook review page the shop pastes in. Nullable: with
     * none set, the recap flow has nowhere to send a diver and skips the ask
     * entirely rather than guessing a platform (docs ADR
     * 20260726-post-trip-review-request).
     */
    reviewUrl: text("review_url"),
    /**
     * The shop's physical business address — where a diver actually meets the
     * boat or walks into the storefront, not a staff member's personal one.
     * Every field is nullable independently because a shop that has not
     * filled in its address must not have one guessed on its behalf; a shop
     * can be fully set up with no street on file. `addressCountry` is an ISO
     * 3166-1 alpha-2 code ("US", "MX", …), not a free-text country name.
     */
    addressStreet: text("address_street"),
    addressLocality: text("address_locality"),
    addressRegion: text("address_region"),
    addressPostalCode: text("address_postal_code"),
    addressCountry: text("address_country"),
    /** Diver-facing suggestions shown on every trip; owners configure these once per shop. */
    packingList: jsonb("packing_list")
      .$type<string[]>()
      .notNull()
      .default(["Swimsuit and towel", "Reef-safe sun protection", "Logbook"]),
    /**
     * The gear and services this shop offers (ShopCatalogKind values,
     * src/lib/rentals.ts). Gates which items a diver can pick in the rental-fit
     * forms — a shop that doesn't rent GoPros never offers one — and, for
     * "nitrox", whether a diver can request enriched air at all
     * (shopOffersNitrox). Defaults to the core kit (which now includes the dive
     * computer); the GoPro and nitrox are opt-in — most shops don't fill nitrox.
     * Single-sourced from DEFAULT_SHOP_RENTAL_ITEMS so the stored default can
     * never drift from the canonical kit again.
     */
    rentalItems: jsonb("rental_items")
      .$type<string[]>()
      .notNull()
      .default([...DEFAULT_SHOP_RENTAL_ITEMS]),
    /**
     * What the shop charges for rental gear (minor units), src/lib/rentals.ts. A
     * set price for the full core kit, per-piece prices, and a per-dive nitrox
     * surcharge — all optional. Never inventory or an allocation, only what a diver
     * is quoted. Defaults to unpriced, which keeps the "ask the shop" behaviour.
     */
    rentalPricing: jsonb("rental_pricing")
      .$type<RentalPricing>()
      .notNull()
      .default({ setCents: null, perItemCents: {}, nitroxCents: null }),
    /**
     * **The shop's own rental terms**, printed on every rental ticket above the
     * "Received by" line (Aaron, 2026-10-08; ADR 20260815-minimal-gear-register,
     * amended 2026-10-08). Plain text in the shop's words — when gear is due,
     * what a late or lost unit costs — and optional: null prints no terms.
     * Never a liability release: the one shop-wide waiver stays the only thing
     * a diver signs away anything on (CR-015).
     */
    rentalTerms: text("rental_terms"),
    /**
     * **What Claude should know when it drafts a reply** (Aaron, 2026-10-22):
     * plain text in the shop's words, like where to park or which wetsuits it
     * rents. The `inbox-draft` assist reads it beside the schedule, prices and
     * desk hours (`replyFacts`, `src/db/inbox-assists.ts`), so a number in it
     * is one a draft may quote. Never a diver's details; null is no notes.
     * Replaced saved answers and their `{name}`/`{trip}` markers.
     */
    replyNotes: text("reply_notes"),
    /**
     * **How often the shop services a customer's regulator**, in months: 12 or
     * 24 (issue #2272). Read only by the work-order bench's suggested next-due
     * date for a customer's own regulator, which drives that customer's service
     * reminder (`suggestCareDueOn`, `src/lib/work-orders.ts`). The shop's own
     * fleet never reads it — each unit carries its own clock. Defaults to 12,
     * which errs early.
     */
    customerRegulatorServiceMonths: integer("customer_regulator_service_months")
      .notNull()
      .default(12),
    /**
     * **The numbers a crew reaches for during, not after** — the shop's own
     * chamber, dive-accident hotline, coastguard, vessel and shore contact, and
     * its emergency action plan (`src/lib/emergency-reference.ts`).
     *
     * On `shops` rather than a table of its own because there is exactly one
     * per shop and it is read wholesale on every manifest, the same shape
     * `rentalPricing` takes. It rides in the encrypted offline snapshot, which
     * is the entire point: the document a crew has with no signal carried who
     * is aboard and who to phone afterwards, and nothing for the minute in
     * between (issue #688).
     *
     * DiveDay ships no values. The nearest chamber differs by dock and the
     * hotline differs by country, so a default here would be a confidently
     * wrong number on the one screen that cannot afford one.
     */
    emergencyReference: jsonb("emergency_reference")
      .$type<EmergencyReference>()
      .notNull()
      .default({ lines: [], vessel: "", shoreContact: "", plan: "" }),
    /**
     * **The shore contact's address for a stale roll call** (H-118, decided
     * 2026-10-15): the one person outside the shop's accounts who hears when an
     * after-dive roll call is still open after the boat was due back
     * (`sendStaleRollCallAlerts`, `src/db/roll-call-alerts.ts`). Email only.
     *
     * Beside `emergency_reference.shoreContact`, never instead of it: that is
     * free text a crew reads in an emergency, and this is an address DiveDay
     * sends to. An address is stored only with the consent the staff member
     * recorded for it — when, and who — and the check below holds the pair
     * together, so clearing the address clears the consent and no address
     * without one can exist (`nextShoreAlertContact`,
     * `src/lib/shore-alert-contact.ts`). The person id carries no foreign key,
     * the same as `people.adult_attested_by_person_id`: it is provenance, and
     * a `shops -> people` key would turn the demo cascade into a cycle.
     */
    shoreAlertEmail: text("shore_alert_email"),
    shoreAlertConsentAt: timestamp("shore_alert_consent_at", { withTimezone: true }),
    shoreAlertConsentByPersonId: uuid("shore_alert_consent_by_person_id"),
    /**
     * When the shore contact proved the address is theirs and agreed, by the
     * link DiveDay sent to it (H-118 review; the same proof the front-desk
     * address takes, issue #1288). Null until then, and cleared with any
     * change of address: the shop's tick says they agreed, this says the
     * inbox did. Nothing is sent to the address before it is set
     * (`shoreAlertRecipient`), and the link in every alert that stops them
     * clears all four columns.
     */
    shoreAlertConfirmedAt: timestamp("shore_alert_confirmed_at", { withTimezone: true }),
    /**
     * **The bookkeeper's address for the month-end email** (fifth loop, item
     * 35; ADR 20261016-bookkeeper-month-end-email): on the 2nd of each month
     * the previous month's report, orders and crew sheet go here as three CSV
     * attachments. Off while null. Like the shore contact's, it is an address
     * outside the shop's accounts, so it is stored only with who set it and
     * when (the check below holds the three together), set only by an owner
     * or manager behind the export step-up.
     *
     * `bookkeeper_sent_month` is the claim: the `YYYY-MM` last mailed, moved
     * forward in the same statement that decides to send, so two passes of
     * the hourly job cannot both send one month. Cleared with the address, so
     * a new address starts from the next month due.
     */
    bookkeeperEmail: text("bookkeeper_email"),
    bookkeeperEmailSetAt: timestamp("bookkeeper_email_set_at", { withTimezone: true }),
    bookkeeperEmailSetByPersonId: uuid("bookkeeper_email_set_by_person_id"),
    bookkeeperSentMonth: text("bookkeeper_sent_month"),
    /**
     * **The bookkeeper confirmed this inbox is theirs** (security review B1,
     * on the shore contact's model, H-118): no file leaves until it is set.
     * The link that sets it is single-purpose and expiring, held here as a
     * hash: it can only confirm the address the shop names now, because any
     * change of address clears all three columns. The hash stays after use so
     * the page can read the link back as confirmed.
     */
    bookkeeperConfirmedAt: timestamp("bookkeeper_confirmed_at", { withTimezone: true }),
    bookkeeperConfirmTokenHash: text("bookkeeper_confirm_token_hash"),
    bookkeeperConfirmExpiresAt: timestamp("bookkeeper_confirm_expires_at", {
      withTimezone: true,
    }),
    /**
     * **The stop link in the latest month-end email** (security review N1),
     * as a hash: minted with each month's claim, so only the newest email's
     * link works, and it stops only the address it went to, since any change
     * of address clears it. Kept after a stop so the page can say "stopped".
     */
    bookkeeperStopTokenHash: text("bookkeeper_stop_token_hash"),
    /**
     * **The last month-end files to this address bounced** (issue #2798,
     * security review N2): SES answered a `bookkeeper_month_end` send with a
     * permanent bounce, which is also how it answers an address on its
     * suppression list. Set by the delivery webhook, matched by the send's shop
     * tag and the address on file; cleared by any change of address and by a
     * later delivered send. Reports warns while it is set. Informs only: the
     * pass keeps sending, since nothing here tells a dead inbox from a fixed one.
     */
    bookkeeperBouncedAt: timestamp("bookkeeper_bounced_at", { withTimezone: true }),
    /**
     * **A shop name that could pass for a brand or an institution** (issue
     * #2450, decided 2026-10-16): set when the name matched the denylist in
     * `src/lib/shop-name-review.ts` at sign-up (or a rename). While it is set
     * and `name_cleared_at` is not newer, the shop's mail leaves under the plain
     * "DiveDay" display name instead of "{Shop} via DiveDay"
     * (`shopNameUnderReview`). A human clearing it stamps `name_cleared_at`; a
     * later flag (another matching name) is newer than the clearing and holds
     * again. Neither stops a shop signing up or sending.
     */
    nameFlaggedAt: timestamp("name_flagged_at", { withTimezone: true }),
    nameClearedAt: timestamp("name_cleared_at", { withTimezone: true }),
    /**
     * How many minutes before departure divers are asked to be at the dock. The
     * shop's real muster time varies (gear setup, cert check, briefing), so it is
     * configurable rather than a hardcoded "30 minutes" in every confirmation and
     * reminder. Defaults to 30.
     */
    dockCallMinutes: integer("dock_call_minutes").notNull().default(30),
    /**
     * Whether the shop runs hotel pickups (fourth UX review item 8): `/ready`
     * asks each diver whether they want a pickup and where they are staying,
     * and the manifest lists who to collect. A Features-page switch since
     * 2026-10-23 (`hotelPickup`), on for a new shop like every feature (Aaron,
     * 2026-10-23); a shop that runs no pickups turns it off, and off nobody is
     * asked. Existing shops keep what they chose.
     */
    offersHotelPickup: boolean("offers_hotel_pickup").notNull().default(true),
    /**
     * How the shop takes money at the desk: card, cash, or both (fifth-loop
     * ideas, item 21). Null until the shop says, and then nothing is added to
     * "due at the shop". Read by the booking form's money block, the booking
     * confirmation and `/ready`'s money line.
     */
    deskPayment: deskPayment("desk_payment"),
    /**
     * The rest of the shop's dock-day rhythm, in minutes (src/lib/diver-planning.ts).
     * Before these columns existed the whole day was inferred from
     * `dock_call_minutes` alone — the briefing was half of it capped at 15, and
     * the two beats on the water were the trip window's own thirds — so a shop
     * that briefs on the boat, kits up on board, or runs one tank read DiveDay
     * telling their divers a day they don't run.
     *
     * Zero is meaningful on the four that allow it: it takes the beat out of
     * the day rather than putting it at the departure. `bottom_time_minutes` is
     * the one with no such reading, so its CHECK floors it above zero.
     */
    gearSetupMinutes: integer("gear_setup_minutes").notNull().default(0),
    briefingMinutes: integer("briefing_minutes").notNull().default(15),
    boatRideMinutes: integer("boat_ride_minutes").notNull().default(20),
    bottomTimeMinutes: integer("bottom_time_minutes").notNull().default(45),
    surfaceIntervalMinutes: integer("surface_interval_minutes").notNull().default(60),
    /**
     * The shortest gap the shop wants between one departure due back and the
     * next leaving on the same hull, or with a crew member who leaves from a
     * different meeting point — the time to unload, rinse, refill, refuel and
     * board the next group (issue #2141, Aaron's decision (b), 2026-10-13).
     * The schedule builder's Move panel names a closer departure as advice; it
     * never refuses a move and never changes H-80's clash. Zero turns it off.
     */
    minTurnaroundMinutes: integer("min_turnaround_minutes").notNull().default(30),
    /**
     * How many minutes before the divers' dock call the crew are asked to be
     * at the dock (ux-delight sheet 2026-10-22, item 2; H-149: shop-wide,
     * default 30). Crew who arrive with the customers leave tanks unloaded and
     * the O2 unchecked. A crew member's own shift covering the departure still
     * wins; null means the shop set none, and crew read the divers' time,
     * named as theirs (`crewCallAt`, src/lib/dock-call.ts).
     */
    crewLeadMinutes: integer("crew_lead_minutes").default(30),
    /**
     * Where the shop's season starts — the denominator behind the home's one
     * fact of scale (ADR 20260904-reef-all-the-way-down, decision 2, Budget
     * rule 3). "Your 400th diver of the season" is a claim about a count from
     * a date, and a dive shop's year rarely starts in January, so the shop
     * chooses. Two integers rather than a date because the year is whichever
     * one the anniversary last fell in, which `seasonStartInstant` resolves in
     * the shop's own zone.
     *
     * February is capped at 28 by the constraint below, not 29: a season
     * beginning on a leap day would need a clamp in every reader of it.
     */
    seasonStartMonth: integer("season_start_month").notNull().default(1),
    seasonStartDay: integer("season_start_day").notNull().default(1),
    /**
     * **When the shop is back on the water**, as a shop-local calendar date, or
     * null for nothing to say. Read only while the public board has nothing in
     * its quiet window (`src/lib/off-season.ts`): a scheduled departure always
     * outranks it, and once the date has passed it says nothing, so a date
     * nobody updated goes quiet by itself rather than misleading anybody.
     */
    reopensOn: text("reopens_on"),
    /**
     * **When somebody is at the desk**, as minutes after shop-local midnight:
     * opens inclusive, closes exclusive, the same window every day. A diver
     * message that lands outside it pings the staff who asked to hear
     * (`src/lib/desk-hours.ts`, `src/db/desk-pings.ts`). 08:00–18:00 until the
     * shop says otherwise; a desk that never closes has no "after hours", so
     * the staff who want no pings turn their own off rather than the shop
     * pretending to keep 24-hour hours.
     */
    deskOpensMinute: integer("desk_opens_minute").notNull().default(480),
    deskClosesMinute: integer("desk_closes_minute").notNull().default(1080),
    /**
     * When the shop last saved its desk hours. The public footer prints them
     * ("Desk open 7:00 to 17:00") only once this is set: the 08:00 to 18:00
     * default is a guess for deciding after-hours pings, and a guess printed
     * on a storefront is a promise the shop never made. A timestamp for the
     * reason `units_confirmed_at` is one.
     */
    deskHoursConfirmedAt: timestamp("desk_hours_confirmed_at", { withTimezone: true }),
    /**
     * When the shop last saved its units — the signal behind the setup
     * checklist's "check your currency and depth unit" step. Onboarding now
     * *derives* both from the timezone (`src/lib/curated-defaults.ts`), and a
     * derived default nobody looked at is the same failure with extra steps:
     * `price_cents` counts the current currency's minor unit, and a depth typed
     * under the wrong unit was converted on the way in (issue #712).
     *
     * A timestamp rather than a boolean, so "confirmed, then the shop changed
     * its mind about the zone" is answerable later without another column.
     */
    unitsConfirmedAt: timestamp("units_confirmed_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    /**
     * When this shop asked to be left out of search engines. Null — the
     * default — means its public pages are in the sitemap and indexable, which
     * is what a shop is on DiveDay for (ADR 20260813-search-listing-is-a-choice).
     *
     * A timestamp rather than a boolean, matching every other reversible act
     * on this schema: the interesting question later is *when* a shop opted
     * out, and a `false` cannot answer it. Set it and the public schedule and
     * course pages emit `robots: noindex` and drop out of the sitemap; clear
     * it and they come back.
     */
    searchListingOptOutAt: timestamp("search_listing_opt_out_at", { withTimezone: true }),
    tagline: text("tagline"),
    description: text("description"),
    logoUrl: text("logo_url"),
    /**
     * Harbor (ADR 20260901-diveday-reimagined, decision 2): the shop's own
     * brand, worn by every diver-facing surface and every embed. Each is
     * optional, and a shop that has set none sees the storefront in DiveDay's
     * own tokens — the brand is an overlay with a default, never a requirement.
     * `brand_color` is one `#rrggbb`; `src/lib/brand.ts` derives hover, tint
     * and ink-on-brand from it and checks contrast, so nothing else is stored.
     */
    brandColor: text("brand_color"),
    brandDisplayFont: brandDisplayFont("brand_display_font"),
    brandHeroImageUrl: text("brand_hero_image_url"),
    /** Real alt text, staff-authored, for the hero photograph. */
    brandHeroImageAlt: text("brand_hero_image_alt"),
    /**
     * The storefront's photo strip, under the cover: the boats, the crew, the
     * reef, in the order the shop uploaded them. First-party storage URLs only
     * (`storeShopHeroImage`, the cover's own prefix), capped at
     * `MAX_SHOPFRONT_PHOTOS`. Decorative on the page, so no alt text column.
     */
    shopfrontPhotoUrls: jsonb("shopfront_photo_urls").$type<string[]>().notNull().default([]),
    /** The year the shop opened, for "Since 1998" on the badge wall. */
    establishedYear: integer("established_year"),
    /**
     * The badge wall: coded affiliations the shop chooses to show, in the
     * order it chose them — `BRAND_BADGE_CODES` in `src/lib/brand.ts`. Codes,
     * never words or logos: a code arrives in every language, and DiveDay
     * draws a text badge rather than a mark it has no right to show. Like every
     * badge, these are shop claims.
     */
    brandBadges: jsonb("brand_badges").$type<string[]>().notNull().default([]),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("shops_inbound_email_token_unique").on(table.inboundEmailToken),
    uniqueIndex("shops_bookkeeper_confirm_token_hash_unique").on(table.bookkeeperConfirmTokenHash),
    uniqueIndex("shops_bookkeeper_stop_token_hash_unique").on(table.bookkeeperStopTokenHash),
    check("shops_dock_call_minutes_nonnegative", sql`${table.dockCallMinutes} >= 0`),
    // H-118: an address DiveDay sends to exists only with its recorded consent.
    check(
      "shops_shore_alert_consent",
      sql`(${table.shoreAlertEmail} is null and ${table.shoreAlertConsentAt} is null
        and ${table.shoreAlertConsentByPersonId} is null)
        or (${table.shoreAlertEmail} is not null and ${table.shoreAlertConsentAt} is not null
        and ${table.shoreAlertConsentByPersonId} is not null)`,
    ),
    // Item 35: the bookkeeper's address exists only with who set it and when.
    check(
      "shops_bookkeeper_email_provenance",
      sql`(${table.bookkeeperEmail} is null and ${table.bookkeeperEmailSetAt} is null
        and ${table.bookkeeperEmailSetByPersonId} is null)
        or (${table.bookkeeperEmail} is not null and ${table.bookkeeperEmailSetAt} is not null
        and ${table.bookkeeperEmailSetByPersonId} is not null)`,
    ),
    // A confirmation, or a link to give one, exists only for an address on file.
    check(
      "shops_bookkeeper_confirmation_has_address",
      sql`${table.bookkeeperEmail} is not null
        or (${table.bookkeeperConfirmedAt} is null and ${table.bookkeeperConfirmTokenHash} is null)`,
    ),
    // A bounce is about the address on file; none is held without one.
    check(
      "shops_bookkeeper_bounce_has_address",
      sql`${table.bookkeeperEmail} is not null or ${table.bookkeeperBouncedAt} is null`,
    ),
    check(
      "shops_bookkeeper_confirm_token_expiry",
      sql`(${table.bookkeeperConfirmTokenHash} is null) = (${table.bookkeeperConfirmExpiresAt} is null)`,
    ),
    check(
      "shops_bookkeeper_sent_month_shape",
      sql`${table.bookkeeperSentMonth} is null or ${table.bookkeeperSentMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    // A confirmation vouches for an address; there is none without one.
    check(
      "shops_shore_alert_confirmed_has_address",
      sql`${table.shoreAlertConfirmedAt} is null or ${table.shoreAlertEmail} is not null`,
    ),
    check(
      "shops_customer_regulator_service_months_choice",
      sql`${table.customerRegulatorServiceMonths} in (12, 24)`,
    ),
    // The same window `parseDeskHours` accepts (`src/lib/desk-hours.ts`): a
    // day's minutes, opening before closing.
    check(
      "shops_desk_hours_in_day",
      sql`${table.deskOpensMinute} >= 0 and ${table.deskClosesMinute} <= 1440
        and ${table.deskOpensMinute} < ${table.deskClosesMinute}`,
    ),
    // The shape `isValidCalendarDate` checks in full (src/lib/calendar-date.ts);
    // the settings action refuses an impossible day before it gets here.
    check(
      "shops_reopens_on_is_a_date",
      sql`${table.reopensOn} is null or ${table.reopensOn} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    // The same days `parseSeasonStart` accepts (`src/lib/season.ts`). A
    // constraint looser than the action it backs lets any other caller
    // persist a date the counting would have to guess about.
    check(
      "shops_season_start_month_in_range",
      sql`${table.seasonStartMonth} >= 1 and ${table.seasonStartMonth} <= 12`,
    ),
    check(
      "shops_season_start_day_in_month",
      sql`${table.seasonStartDay} >= 1 and ${table.seasonStartDay} <= 31
        and not (${table.seasonStartMonth} = 2 and ${table.seasonStartDay} > 28)
        and not (${table.seasonStartMonth} in (4, 6, 9, 11) and ${table.seasonStartDay} > 30)`,
    ),
    // A year a shop could plausibly have opened in. Bounded at both ends like
    // every other numeric setting, so no caller can persist a figure the
    // storefront would print as nonsense.
    check(
      "shops_established_year_plausible",
      sql`${table.establishedYear} IS NULL OR (${table.establishedYear} >= 1900 AND ${table.establishedYear} <= 2100)`,
    ),
    // `#rrggbb`, lowercase, or nothing — the one shape `src/lib/brand.ts` parses.
    check(
      "shops_brand_color_hex",
      sql`${table.brandColor} IS NULL OR ${table.brandColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    check("shops_gear_setup_minutes_nonnegative", sql`${table.gearSetupMinutes} >= 0`),
    check("shops_briefing_minutes_nonnegative", sql`${table.briefingMinutes} >= 0`),
    check("shops_boat_ride_minutes_nonnegative", sql`${table.boatRideMinutes} >= 0`),
    check("shops_bottom_time_minutes_positive", sql`${table.bottomTimeMinutes} > 0`),
    check("shops_surface_interval_minutes_nonnegative", sql`${table.surfaceIntervalMinutes} >= 0`),
    check(
      "shops_min_turnaround_minutes_range",
      sql`${table.minTurnaroundMinutes} >= 0 and ${table.minTurnaroundMinutes} <= 240`,
    ),
    // The same bounds as `CREW_LEAD_LIMITS` (src/lib/dock-call.ts) and the form.
    check(
      "shops_crew_lead_minutes_range",
      sql`${table.crewLeadMinutes} IS NULL OR (${table.crewLeadMinutes} >= 5 and ${table.crewLeadMinutes} <= 180)`,
    ),
    // Bounded at both ends, matching `parseDiversPerDivemaster` in the settings
    // action. A DB constraint looser than the action it backs lets any other
    // caller persist a number the surfaces will not honour (`coderabbitai`);
    // above twenty the number has stopped describing supervision at all.
    check(
      "shops_divers_per_divemaster_in_range",
      sql`${table.diversPerDivemaster} >= 1 and ${table.diversPerDivemaster} <= 20`,
    ),
    /**
     * A shop that runs no dives at all cannot schedule one, and every create
     * path defaults to `boat`, so an all-false row would leave the builder with
     * nothing to offer and a departure whose mode the shop has disowned.
     */
    check(
      "shops_offers_some_dive_mode",
      sql`${table.hasBoatDiving} or ${table.hasShoreDiving} or ${table.hasPoolDiving}`,
    ),
  ],
);

export type MedicalJurisdiction = (typeof medicalJurisdiction.enumValues)[number];

/**
 * The standing roles a person holds in a shop. Keep aligned with `ALL_ROLES`
 * in src/lib/authz.ts.
 *
 * `assistant_instructor` is a **rung**, not a job on a boat, which is why it is
 * here and deliberately not in `trip_assignment_role` below. It was added
 * because a shop with an AI on staff had nowhere to file them but `instructor`,
 * and the in-water ratio then credited them a full instructor's student
 * allowance and cleared a course's "needs an instructor" gap — a claim about
 * the water that is not true of an AI, who is a certified assistant for
 * training-dive ratios and is not the rated professional of record for the
 * open-water dive of a Discover Scuba experience (issue #1680, ruled
 * 2026-09-16).
 */
export const personRole = pgEnum("person_role", [
  "owner",
  "manager",
  "instructor",
  "assistant_instructor",
  "divemaster",
  "captain",
  "crew",
  "diver",
]);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * **`COLLATE "und-x-icu"` in the database**, set by
     * `drizzle/20260911200158_person-name-collation`. The type here is plain
     * `text` because drizzle-orm's pg-core has no way to say it — and because
     * drizzle-kit only *reports* a collation delta rather than modelling one,
     * a later `pnpm db:generate` will not take it back off.
     *
     * The collation lives on the column so that it lives nowhere else.
     * Twenty-one `orderBy(asc(people.fullName))` call sites across `src/db`
     * inherit it with no query edit, and `offsetPage` (src/db/paging.ts) slices
     * exactly that order — so a name list ordered by the database default is
     * not merely untidy, it is a wrong *page one*, with `Ángel` and `Ñuria`
     * after `Zoe` where a Spanish reader looks for them near the top. The
     * default is `C` (byte order) on PGlite and whatever initdb was handed on a
     * server, which is why the suite and production could not agree until the
     * column answered for itself. `src/db/name-collation.test.ts` proves it on
     * PGlite and `name-collation.postgres.test.ts` on a real server.
     */
    fullName: text("full_name").notNull(),
    /** Nullable: walk-ups may not have one on file yet. */
    email: text("email"),
    phone: text("phone"),
    /** Manifests require these; nullable until collected at booking/check-in. */
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    /**
     * Date-only, no timezone (CR-009): a birthday is a calendar fact, not an
     * instant. Nullable and **fails open** by product decision (H-08, option B):
     * a course's `minimum_age` is enforced only for a diver who actually has a
     * date on file, so shipping this never blocks the divers already on the
     * books. Real age verification stays a dock-side ID check; this catches the
     * mis-aged booking early when the data happens to be there.
     */
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    /**
     * **When a staffer said, at the counter, that this person is 18 or older**
     * without giving a date of birth (H-100, issue #2143). Written only by
     * `splitBookingIdentity`: a held seat split into a new diver must carry a
     * date or this answer, because the split exists for a person who is *not*
     * the matched diver, and the common case is a minor booked with a parent's
     * email. A blank date there would read as an adult by default; this column
     * makes it an adult by someone's say-so.
     *
     * A date of birth replaces it: the guardian rule and the age gate read the
     * date and never this, and typing a date (`updateDiver`) or merging onto
     * one nulls this pair, so clearing that date later cannot bring back an
     * adult claim the date may have disproved. Null everywhere else, which is
     * the ordinary H-08 case of a record nobody asked about.
     */
    adultAttestedAt: timestamp("adult_attested_at", { withTimezone: true }),
    /**
     * Which staffer gave that answer. Not a typed FK, for the self-reference
     * reason `no_certification_cleared_by_person_id` gives: the row's own
     * trail, because an age answer outlives the pruned activity log.
     */
    adultAttestedByPersonId: uuid("adult_attested_by_person_id"),
    /**
     * Dive-accident insurance the diver carries — DAN or another provider, as
     * free text ("DAN #12345"). A safety detail the crew wants on hand in an
     * incident, never a gate; null until the diver or staff records it
     * (docs/product/glossary.md — "DAN").
     */
    diveInsurance: text("dive_insurance"),
    /**
     * **When this person said, on a public opt-in, that they hold no
     * certification at all** — Discover Scuba and Try Scuba customers,
     * snorkellers, the non-diving half of a couple, somebody booked onto a
     * course they have not started. Null means they never said it.
     *
     * It is a column on the *person* and deliberately **not** a row in
     * `certifications`, which is the whole point of it (ADR
     * 20260814-self-declared-cards, amendment 2026-08-15). A Discover Scuba
     * experience is not a certification, every other row in that table asserts
     * that a card exists, and a row asserting the opposite would have to be
     * special-cased by readiness, admission, the CSV export, the incident
     * document and the importer — five readers, of which the one that misses it
     * turns "no card" into a card. For the same reason there is no `none` rung
     * on `certification_level`: that enum is a ladder `certificationRank`
     * orders, and a rank-0 member would eventually be compared as a level.
     *
     * Three things hang off it, and none of them is a gate:
     *
     * - It is written only by `recordSelfDeclaredCards`, under the same
     *   anti-displacement rule a declared *level* gets: if this person holds any
     *   live card that is not itself a still-unsighted claim, nothing is written
     *   at all. The forms are unauthenticated.
     * - It is **ignored, not deleted**, once a level lands beside it — where a
     *   record began is history, exactly as `certifications.self_declared_at`
     *   is kept after a sighting.
     * - It renders in the one staff phrase a level renders in ("Not certified
     *   yet — unverified"), so a staffer scanning a send list can tell this
     *   answer from the silence of somebody who skipped the question.
     */
    noCertificationDeclaredAt: timestamp("no_certification_declared_at", { withTimezone: true }),
    /**
     * **When a staffer said this diver never gave that answer** — the eraser
     * for a stamp above that a stranger typed.
     *
     * The forms that write `no_certification_declared_at` are unauthenticated
     * and resolve a person by shop + email, so for a diver the shop holds no
     * card for, anybody who knows a name and an email address can mark them
     * *"Not certified yet — unverified"* on the send lists and in every CSV
     * the shop exports from then on. Until this column there was exactly one
     * way back, and it was owner-only erasure of the whole record.
     *
     * **A second column rather than nulling the first**, for the reason the ADR
     * gives about `self_declared_at`: where a record began is history, and an
     * eraser that removed the evidence of its own subject would leave a shop
     * unable to answer "did this diver ever tell us that?". Set, the stamp is
     * *superseded* — every reader treats the person as having said nothing,
     * which is the silence of somebody nobody asked, never a card.
     *
     * That direction is the whole safety argument: this control can only move a
     * record from a stated absence to no statement at all. Evidence lives in
     * the three card tables and nothing here touches them, so clearing can
     * never turn a claim into a card (ADR 20260814-self-declared-cards).
     *
     * A later public declaration clears this again (`recordSelfDeclaredCards`)
     * — otherwise one correction would silently swallow every answer the diver
     * gave afterwards, which is a gate nobody chose. Structural rather than a
     * comparison of the two timestamps, because the e2e fleet freezes the clock
     * outright and two instants recorded under it are equal.
     */
    noCertificationClearedAt: timestamp("no_certification_cleared_at", { withTimezone: true }),
    /**
     * Which staff member cleared it. Not a typed FK: the reference is to this
     * same table, and a self-referencing `references()` trips drizzle's type
     * inference the way `bookings.party_lead_booking_id` documents. A
     * correction to somebody else's safety-adjacent record is the kind of act
     * that has to name its author, so this is the row's own trail rather than
     * an `activity_events` line — that table is trip-scoped everywhere it is
     * read and is pruned on a retention window, and this fact outlives both.
     *
     * **It survives a later public declaration, and the column beside it does
     * not.** The writer of that declaration is an unauthenticated form; letting
     * it null this would let an anonymous post erase the shop's audit of its own
     * correction, and let a griefer loop the stamp back on with nothing left
     * saying a staffer had ever disagreed. So set-with-a-null-`cleared_at` is a
     * real state and reads as *corrected once, and stated again since*.
     */
    noCertificationClearedByPersonId: uuid("no_certification_cleared_by_person_id"),
    /**
     * When a staff member recorded that they have seen this diver dive dry
     * (issue #2136, Aaron 2026-10-13). Clears the roster's drysuit-card
     * advisory (`checkDrysuitCard`) and nothing else: it is **not a card**,
     * never reaches `specialty_certifications`, `calculateReadiness` or
     * admission, and a site or trip that requires the `drysuit` specialty
     * still refuses without one. Staff-only: no diver-facing writer, and
     * `/ready` never sets it. Null means nobody has recorded it.
     */
    drysuitExperienceSeenAt: timestamp("drysuit_experience_seen_at", { withTimezone: true }),
    /**
     * Who recorded `drysuit_experience_seen_at`. Not a typed FK for the same
     * self-reference reason as `no_certification_cleared_by_person_id`. Set
     * and cleared together with the column above.
     */
    drysuitExperienceSeenByPersonId: uuid("drysuit_experience_seen_by_person_id"),
    /**
     * What the staffer saw, in their words: the suit, where, when (domain
     * review A4). Required by the writer, 1 to 200 characters, and set and
     * cleared with the two columns above. The record and each clear also
     * leave an append-only line on the diver's activity trail (A5).
     */
    drysuitExperienceSeenNote: text("drysuit_experience_seen_note"),
    /**
     * **The last dive the shop knows of, anywhere**, as a staff member wrote
     * it on the diver's record (Aaron, 2026-10-23; ADR
     * 20261023-last-known-dive). A calendar day, not a band: "14 March 2025
     * in Bonaire" off a logbook or a computer is a fact that stays true, where
     * "within a year" goes stale the day after it is said — which is why the
     * diver's own answer on `/ready` stays a band on the booking
     * (`bookings.last_dived_band`, ADR 20260821-currency-is-what-catches-people).
     *
     * Never read alone. The record shows the later of this and the diver's
     * own last dive day with the shop (`lastKnownDive`, src/db/last-dive.ts),
     * so a trip with the shop moves the date forward without anybody typing
     * it, and nothing moves it back. **Gates nothing**, like the band: a
     * refresher is a divemaster's conversation, not a refusal. Null is "not
     * recorded". Erasure takes it; a merge keeps the later of the two.
     */
    lastDiveOn: date("last_dive_on", { mode: "string" }),
    /**
     * The language this diver reads, captured from the `Accept-Language` of a
     * request they made themselves (a public booking, a waiver signature) and
     * preferred over the shop's `default_locale` when DiveDay emails or texts
     * them (docs ADR 20260731-per-person-notification-locale, superseding
     * 20260731-notification-locale).
     *
     * Null means "no first-hand signal" — the shop's locale is used, exactly as
     * before. Only ever written from a request the diver themselves made:
     * staff-triggered actions carry the *staff* member's header, which says
     * nothing about what the diver reads.
     */
    locale: text("locale"),
    /**
     * Languages this person can hold a conversation in — not what DiveDay
     * shows *them*, but what a staff member can say to a diver. BCP-47
     * primary-language tags (`"de"`, `"ja"`, never a free-text sentence like
     * "conversational German"), a set with no ranking and no proficiency
     * scale: "we speak German" is the whole claim a badge can honestly make,
     * and a shop can put nuance in its own words elsewhere (issue #708).
     *
     * Staff-only in practice — set from the team settings form — but the
     * column lives on every `people` row rather than a staff-only table
     * because `people` already is that unified table (a diver row simply
     * never has one written to it, the same as `noCertificationDeclaredAt`
     * only ever being set on a diver's).
     *
     * Empty by default and nothing downstream requires it: a shop that never
     * fills this in sees no badge, no "we speak" line, and no crew-language
     * signal — the whole feature is additive.
     */
    // Typed to the fixed set, not a bare `string[]`, so a future writer that
    // skips `setStaffLanguages`' own filtering fails to compile rather than
    // silently storing an arbitrary string (`security-reviewer`, issue #708).
    spokenLanguages: jsonb("spoken_languages").$type<SpokenLanguageTag[]>().notNull().default([]),
    /**
     * **When this staff member agreed to be named to divers** (issue #1181,
     * delight report D21) -- null until they say so, which is every row.
     *
     * The public trip page has always been able to say *"we speak German"*
     * (`tripCrewSpokenLanguages`, issue #708): an anonymous claim about the
     * shop's capability, deliberately naming nobody. Saying *"Marcus, your
     * divemaster, speaks German"* is a different act on a page anyone on the
     * internet can read, and it is not the shop's to decide.
     *
     * So this is the person's own switch and nobody else's.
     * `saveStaffLanguagesAction` is behind the team-management gate, because
     * which languages a shop can field is an operational fact a manager
     * curates; publishing somebody's name is not, and a consent a manager
     * recorded on their behalf would not be one. The action that writes this
     * refuses any `personId` but the caller's, and the team page draws the
     * control on the reader's own row alone.
     *
     * A timestamp rather than a boolean, like `consentedAt` and
     * `unsubscribedAt`: for a consent record, *when* is half of what makes it
     * a record. Withdrawing sets it back to null -- the fact worth keeping is
     * the standing answer, and a shop holding a former employee's revoked
     * consent date serves nobody.
     */
    crewPublicConsentAt: timestamp("crew_public_consent_at", { withTimezone: true }),
    /**
     * **The exact string that publishes** (issue #1351).
     *
     * `full_name` is one free-text box a shop types into, so deriving the
     * published name as its first whitespace token is a guess about naming
     * order, not a fact: a row entered "Tanaka Keiko" or "Smith, John"
     * publishes the *surname* to an anonymous, indexed page -- which is
     * precisely what the consent beside it does not cover. The person types
     * what divers see, defaulted to that first token so the ordinary case is
     * still one tap, and `tripPublicCrew` reads this rather than splitting.
     *
     * Paired with the stamp by a check constraint below rather than by
     * convention. A consent with no name stored is not a state worth
     * tolerating in a reader: it renders an empty crew line with no error and
     * no failing test, which is the shape that ships silently.
     */
    crewPublicName: text("crew_public_name"),
    /**
     * Set once this person self-serves out of courtesy email — every kind
     * that asks something of the diver's attention beyond their own booking
     * rather than confirming or protecting it: wait-list openings, post-trip
     * recaps, checkout reminders and cold staff invitations. The list itself
     * lives on `issuePersonCourtesyEmailUnsubscribeToken` in
     * `src/db/courtesy-email.ts` (docs features/story-backlog.md "Leo —
     * self-serve email unsubscribe"). Deliberately narrower than
     * an anytime interest's `closed_as = 'unsubscribed'`: that opts a person out of
     * a *list they joined*, this one opts a person out of the courtesy
     * notification *kinds* everyone is eligible for, so it can't reuse the
     * same row. Never suppresses booking confirmations, waiver requests, trip
     * reminders, or a conditions hold — those stay mandatory regardless of
     * this flag.
     */
    courtesyEmailOptOutAt: timestamp("courtesy_email_opt_out_at", { withTimezone: true }),
    /** Keeps history intact while removing a person from active shop workspaces. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * **The diver filled this record in themselves**, at the shop's own QR or
     * printed card, before any booking existed (issue #1236).
     *
     * A date rather than a flag, because "when" is what a staffer standing at
     * the counter actually wants: a person who registered this morning is the
     * one in front of them, and one who registered in March is a returning
     * diver whose details may have moved on.
     *
     * Set **only when the row is created**. A returning diver re-submitting the
     * form is matched by email and keeps the stamp they already had — and a
     * person the shop typed in itself never gets one, so the mark means
     * precisely "this came from the diver" and not "this was recent".
     *
     * It is also load-bearing for what a shop trusts: nothing here is reviewed
     * evidence. The certification is `self_declared_at`, the fit is a
     * preference, and the medical answers arrive through the ordinary waiver
     * flow with the ordinary hard block.
     */
    selfRegisteredAt: timestamp("self_registered_at", { withTimezone: true }),
    /**
     * Set when this person's identifying and medical data was destructively
     * erased across the shop's tables (ADR 20260802-diver-data-erasure).
     *
     * Deliberately **not** the same column as `deleted_at`. Removal is
     * reversible and preserves the record (ADR 20260719-crud-archive-semantics);
     * erasure destroys it and cannot be undone, so the two are separate
     * operations with separate markers and separate authorization. The check
     * constraint below is what makes "one way" structural rather than a
     * convention: an erased row must stay removed, so `restoreDiver`'s
     * `deleted_at = null` write can never resurrect a half-erased person into
     * the active roster — the database refuses it even if a future caller
     * forgets to look.
     */
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    /**
     * The shop owner who ordered the erasure. A one-way, evidence-reducing
     * action is never anonymous — the same reasoning
     * `rental_fit_profiles.needs_staff_fit_by` and
     * `roll_call_events.recorded_by_person_id` record who called a safety flag.
     */
    anonymizedByPersonId: uuid("anonymized_by_person_id").references((): AnyPgColumn => people.id),
    /**
     * The surviving person record after an explicit staff merge. The source
     * row remains as a soft-deleted, auditable shell so old activity trails and
     * exported identifiers never silently change owners (issue #730).
     */
    mergedIntoPersonId: uuid("merged_into_person_id").references((): AnyPgColumn => people.id),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    mergedByPersonId: uuid("merged_by_person_id").references((): AnyPgColumn => people.id),
    /**
     * **The booking whose seat made this person** (issue #2665): a name-only
     * seat with no email of its own inserts a fresh person, stamped here with
     * that seat's booking. Null for every other person — a contact import, a
     * staff-typed diver, anyone found by email. The parent's door (ADR
     * 20261014-parent-signs-minor-release) opens only where this equals the
     * seat's booking, so a merge onto an imported record with no history
     * never passes for "a person this booking made": a merge keeps the
     * survivor's stamp. Never rewritten. No foreign key: `bookings` is
     * declared in a module that imports this one, and a booking is never
     * hard-deleted.
     */
    createdByBookingId: uuid("created_by_booking_id"),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("people_shop_idx").on(table.shopId),
    check(
      "people_anonymized_stays_removed",
      sql`${table.anonymizedAt} is null or ${table.deletedAt} is not null`,
    ),
    check(
      "people_merged_stays_removed",
      sql`${table.mergedIntoPersonId} is null or ${table.deletedAt} is not null`,
    ),
    check(
      "people_merge_metadata_complete",
      sql`(${table.mergedIntoPersonId} is null and ${table.mergedAt} is null and ${table.mergedByPersonId} is null) or (${table.mergedIntoPersonId} is not null and ${table.mergedAt} is not null and ${table.mergedByPersonId} is not null)`,
    ),
    check(
      "people_cannot_merge_into_self",
      sql`${table.mergedIntoPersonId} is null or ${table.mergedIntoPersonId} <> ${table.id}`,
    ),
    // Case-insensitive so "Nora@x.com" and "nora@x.com" can never split one
    // diver's cert/waiver/rental history into two rows (CR-008). Partial on
    // the live rows only, matching the archive-not-delete pattern elsewhere:
    // a soft-deleted person's email frees up for a genuinely new person, and
    // an undelete that would collide with an active row is refused
    // (src/db/people.ts — findOrCreatePerson, restoreDiver-style callers).
    uniqueIndex("people_shop_email_unique")
      .on(table.shopId, sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} is null and ${table.email} is not null`),
    // Backs the leading-wildcard ILIKE search every staff box runs
    // (`personSearchMatch`, src/db/person-search.ts) — a plain btree can't serve
    // `ilike '%query%'`, only pg_trgm's GIN similarity index can (CR-018).
    index("people_full_name_trgm_idx").using("gin", sql`${table.fullName} gin_trgm_ops`),
    index("people_email_trgm_idx").using("gin", sql`${table.email} gin_trgm_ops`),
    index("people_phone_trgm_idx").using("gin", sql`${table.phone} gin_trgm_ops`),
    // The same column with its punctuation removed. `people.phone` is free text
    // — the seed holds "+1 305 555 0142" — so a staffer typing the digits off a
    // caller ID matched nothing (issue #719). Search compares digits to digits
    // now, and an expression index is what keeps that comparison indexed rather
    // than turning every bare-digit query into a sequential scan. The
    // expression here must stay character-for-character identical to the one in
    // `src/db/person-search.ts`, or Postgres will not use this index at all.
    //
    // `[^0-9]` rather than `\D` deliberately: drizzle-kit's migration writer
    // swallows the backslash, so `\D` reached the generated SQL as a bare `D`
    // — an index that strips the letter D from phone numbers, and one Postgres
    // would never match against the query's own expression. A character class
    // has nothing to escape.
    // Consent and the string it publishes travel together, in both directions:
    // agreeing without a name to show would render an empty line, and holding
    // somebody's chosen public name after they withdrew would republish it the
    // moment anything set the stamp again.
    check(
      "people_crew_public_name_with_consent",
      // `nullif(btrim(...), '')` rather than a bare null test: an empty string
      // is not null, so the plain pairing admitted `consent_at = now(),
      // crew_public_name = ''` -- a row that renders a bullet with no name on
      // it, which is the exact silent-empty outcome this constraint exists to
      // make impossible.
      sql`(${table.crewPublicConsentAt} is null) = (nullif(btrim(${table.crewPublicName}), '') is null)`,
    ),
    index("people_phone_digits_trgm_idx").using(
      "gin",
      sql`regexp_replace(coalesce(${table.phone}, ''), '[^0-9]', '', 'g') gin_trgm_ops`,
    ),
  ],
);

export const personRoles = pgTable(
  "person_roles",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    role: personRole("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.personId, table.role] })],
);

/**
 * The agencies a diver's card can be recorded under.
 *
 * Recording only, never gating: nothing in `src/lib/readiness.ts`,
 * `trip-admission.ts`, or the nitrox gate reads the agency — a card clears on
 * its *level* and its verification state, both of which are agency-independent
 * by design, because a CMAS two-star and a PADI Advanced Open Water diver are
 * the same diver at the rail. Widening this list therefore admits no one it did
 * not already admit; it only ends the alternative, which was recording an
 * honest card as "other" (DOM-L1, review 20260802).
 *
 * `bsac` is a national governing body with a full ISO-aligned ladder (Ocean
 * Diver / Sports Diver / Dive Leader / Advanced Diver / First Class Diver) and
 * the most common non-listed card on a Florida or Caribbean boat, on UK visitor
 * traffic alone — it was the omission the first widening still left in place
 * (`dive-domain-expert` review of DOM-L1).
 *
 * The cave-diving bodies `nss_cds` and `nacd`, and the technical agency
 * `iantd`, are common issuers of Florida Cavern cards, and Cavern is a gating
 * specialty (issue #2091). Recording them
 * under their own name is still recording only: no cave rating is a tier here,
 * and a cave card is never read as a Cavern card (ADR
 * 20260718-specialty-site-cert-requirements, 2026-10-05 amendment).
 *
 * Still absent, ranked by how often a shop meets one: SEI, ANDI, ACUC, PSAI,
 * NASE. The list is deliberately not exhaustive — see
 * docs/product/glossary.md, "Other agency", for why the honest fix is a
 * free-text companion to `other` rather than an ever-longer enum.
 *
 * `other` stays last for the reader's sake, not the database's — the cert forms
 * render `AGENCY_KEYS` in declaration order, so it is the picker's final option
 * rather than something buried mid-list.
 *
 * `courses.agency` is a **different** field: free text a shop types, and the one
 * `src/lib/course-ratios.ts` reads for the PADI-only entry-level ratio cap. This
 * enum does not reach it.
 */
export const certificationAgency = pgEnum("certification_agency", CERTIFICATION_AGENCIES);

/**
 * One name for the agency list, so a widening lands everywhere at once.
 *
 * Spelling the union out by hand is how the enum and its readers drift: the
 * three agencies DOM-L1 added had to be typed into five separate literal
 * copies, each of which would have compiled perfectly while silently refusing a
 * card the database accepts.
 */
export type CertificationAgency = (typeof certificationAgency.enumValues)[number];

/** Ordered in src/lib/readiness.ts — extend deliberately with the rank map. */
export const certificationLevel = pgEnum("certification_level", [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
]);

export const certificationStatus = pgEnum("certification_status", ["pending", "verified"]);

/**
 * Activity-gating specialties that attach to a site or trip ("this wreck
 * requires AOW + Deep"). Each is a distinct yes/no gate, never a ladder rung,
 * so they live apart from the recreational-level rank map in readiness.ts.
 * Nitrox is deliberately absent: nitrox_certifications gates the per-booking
 * mix request, not a site.
 */
export const diveSpecialty = pgEnum("dive_specialty", [
  "deep",
  "wreck",
  "night",
  "drysuit",
  "cavern",
]);

/**
 * `invited`: a staff invite created this row (`inviteStaffMember`,
 * src/db/staff-accounts.ts) but the invitee hasn't accepted yet — an unusable
 * random password hash, no sign-in, excluded from `verifyCredentials` and
 * `loadActiveStaffRoles` exactly like `disabled` (both already gate on
 * `status === "active"`). Accepting the invite at `/invite/[token]` flips it
 * to `active`. See 20260726-staff-invite-accounts.
 */
export const accountStatus = pgEnum("account_status", ["invited", "active", "disabled"]);

/**
 * A login method attached to a person — not an identity. Roles stay on
 * person_roles; staff-ness is derived, never stored here (ADR-0006).
 */
export const userAccounts = pgTable(
  "user_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    email: text("email").notNull(),
    /**
     * Ours, not better-auth's: `verifyCredentials` (src/lib/credentials.ts)
     * compares against this column directly and better-auth's own `user` model
     * has never heard of it. Nullable for exactly that reason — 1.7.3's adapter
     * refuses to serve any request whose schema holds a required column it
     * never writes, because a row *it* created would have no password at all
     * (issue #1588). Every writer here sets one — a random unusable hash at
     * invite (`inviteStaffMember`), the real one on activation or reset
     * (`activateStaffAccount`, `setAccountPassword`) — and the single reader
     * falls back to the decoy hash, so a null can never match a submitted
     * password.
     */
    hashedPassword: text("hashed_password"),
    status: accountStatus("status").notNull().default("active"),
    /**
     * Null until the account confirms it owns its own address via
     * `/verify/[token]` (20260725-account-lifecycle-emails). Tracked, but not
     * yet a sign-in gate — an unverified account works exactly like a
     * verified one today.
     */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /**
     * A plain boolean mirror of `emailVerifiedAt`, kept in sync by the same
     * writers (`markEmailVerified`/`activateStaffAccount`,
     * src/db/user-accounts.ts). better-auth's `user` model (this table,
     * mapped onto it via the Drizzle adapter's schema option) wants a real
     * boolean column by this name; `emailVerifiedAt` stays the field our own
     * domain code reads, since it also carries *when*.
     */
    emailVerified: boolean("email_verified").notNull().default(false),
    /**
     * Two more better-auth `user`-model core fields with nowhere honest to
     * live: a staff member's display name is `people.full_name`, never
     * duplicated here, and no avatar upload exists for a staff account.
     * `image` is optional in better-auth's own schema and stays null; `name`
     * is NOT — its cookie-cache validation (`userSchema`) requires a real
     * string, so this is an empty string forever rather than a value that
     * looks synced but silently drifts from `people.full_name`. Nothing in
     * this app reads it; better-auth's own user-creation/update endpoints
     * (the only writers that would ever set it meaningfully) are never
     * called — this table's rows are inserted directly by our own code
     * (staff-accounts.ts, onboard/actions.ts).
     */
    name: text("name").notNull().default(""),
    image: text("image"),
    /**
     * Null until this account dismisses its first-visit role orientation card
     * on Today (UX-persona task 79 — Kai, the day-one seasonal hire).
     * Per-account, not per-browser/device, so dismissing on the shop's shared
     * tablet also clears it on the same person's own phone.
     */
    orientationDismissedAt: timestamp("orientation_dismissed_at", { withTimezone: true }),
    /**
     * This person's own answer to the Monday email (`src/lib/weekly-digest.ts`).
     * Null until they give one, and null means their role's default: on for an
     * owner, off for everyone else (`weeklyDigestWanted`). Stored as the answer
     * rather than materialised at invite time, so an owner promoted later gets
     * the email without a backfill, and "never chose" stays distinguishable
     * from "turned it on" and "turned it off".
     */
    weeklyDigest: boolean("weekly_digest"),
    /**
     * This person's own answer to the after-hours desk ping
     * (`src/lib/desk-hours.ts`). Null until they give one, and null means their
     * role's default: on for an owner or a manager, off for everyone else
     * (`afterHoursPingWanted`), stored as the answer for the reason
     * `weekly_digest` is.
     */
    afterHoursPing: boolean("after_hours_ping"),
    /**
     * When the last after-hours ping went to this person: the batching clock.
     * A ping is claimed by moving this forward only when it is older than
     * `AFTER_HOURS_PING_INTERVAL_MS`, so two messages landing together send
     * one email, and a quiet night sends at most one per interval.
     */
    afterHoursPingedAt: timestamp("after_hours_pinged_at", { withTimezone: true }),
    createdAt: appNowTimestamp("created_at").notNull(),
    /**
     * better-auth's core `user` model requires an `updatedAt`; nothing in
     * this app reads it (our own writers below don't set it, and we never
     * go through better-auth's own update-user endpoint), so it is exactly
     * as stale as `createdAt` unless a future better-auth-owned write path
     * starts touching it.
     */
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_accounts_email_unique").on(table.email),
    uniqueIndex("user_accounts_person_unique").on(table.personId),
  ],
);

export type Shop = typeof shops.$inferSelect;

export type Person = typeof people.$inferSelect;

export type DiveSpecialty = (typeof diveSpecialty.enumValues)[number];
