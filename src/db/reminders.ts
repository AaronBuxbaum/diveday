import { and, asc, eq, gt, inArray, lt, lte, ne } from "drizzle-orm";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { reminderActionText } from "@/i18n/reminder-labels";
import type { DiverLocale } from "@/i18n/settings";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { type CourseLearningMaterial, readLearningMaterials } from "@/lib/courses";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { firstTimerReassuranceText, forecastText } from "@/lib/night-before-brief";
import {
  type Notification,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import { inboundEmailDomain } from "@/lib/notifications/inbound-address";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import {
  buildDiverChecklist,
  type ReminderActionCode,
  reminderReadiness,
} from "@/lib/readiness-summary";
import {
  dueReminder,
  MAX_REMINDER_LEAD_HOURS,
  type ReminderKind,
  reminderEarnsItsSend,
  TRIP_REMINDER_CADENCES,
} from "@/lib/reminders";
import { maySendNow } from "@/lib/send-window";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { issueBookingCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import { courseMaterialsDoneByPerson } from "./course-materials";
import {
  notificationProviderForDb,
  recordNotificationDelivery,
  sendNotificationBatch,
} from "./notifications";
import { listTripsReadiness } from "./readiness";
import {
  bookings,
  courses,
  notificationDeliveries,
  people,
  shops,
  tripScheduleDays,
  trips,
} from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

const REMINDER_KINDS: ReminderKind[] = TRIP_REMINDER_CADENCES.map((c) => c.kind);

/**
 * The subset of these people who have dived with the shop before — anyone with a
 * prior non-cancelled booking on a trip that has already departed. A diver NOT
 * in this set is a first-timer, and the night-before brief speaks to them in a
 * softer, what-happens-on-the-boat voice (brainstorm C's first-timer track).
 * Batched to a single query so the cron scan stays flat regardless of party size.
 */
async function returningDiverIds(db: AppDb, personIds: string[], now: Date): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        inArray(bookings.personId, personIds),
        ne(bookings.status, "cancelled"),
        lt(trips.startsAt, now),
      ),
    );
  return new Set(rows.map((r) => r.personId));
}

export type ReminderRunSummary = {
  /** Active bookings on trips inside the reminder horizon. */
  scanned: number;
  /** Reminders whose tracked channel reported a real send. */
  sent: number;
  /** Bookings with no cadence due this run. */
  skipped: number;
  /**
   * Reminders that *were* due and were not sent, because the shop's civil hours
   * say so (`src/lib/send-window.ts`). Counted apart from `skipped` because the
   * two mean opposite things to whoever reads the log line: `skipped` is "there
   * was nothing to send", `held` is "there was, and it is waiting for morning".
   */
  held: number;
  /**
   * Reminders that were due on a seat staff have not yet matched to a diver
   * (`identity_unconfirmed_at`, #2082). The address on the matched record may
   * be somebody else's, so nothing goes until staff confirm who it is; no
   * delivery row is written, so the cadence re-arms when they do.
   */
  identityHeld: number;
  /**
   * Reminders that were due, were sendable, and were not sent because the diver
   * had nothing left undone (`reminderEarnsItsSend`, issue #1177). A third
   * meaning again: `skipped` is "no cadence was due", `held` is "one was and it
   * is waiting for the shop's morning", and this is "one was, and no message
   * earned its send". Nothing is recorded for these — a falsified delivery row
   * would stop the nudge re-arming when a fact changes later in the same week.
   */
  settled: number;
  /** Reminders whose tracked channel failed or was not configured. */
  failed: number;
};

export type SendDueRemindersOptions = {
  /** Injectable clock; defaults to now. */
  now?: Date;
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  /**
   * Per-shop WhatsApp senders, keyed by shop id; defaults to whatever the
   * scanned shops have connected. A shop present here gets the courtesy text on
   * WhatsApp instead of SMS (docs ADR 20260802-whatsapp-cloud-api-per-shop).
   */
  whatsAppProviders?: Map<string, CourtesyProvider>;
  /** Origin for readiness links; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

/**
 * A short text; the email carries the full detail and the link. The night-before
 * (day) lead adds the plain-language conditions line and who to text, the SMS
 * half of the confidence arc — kept compact so it stays a single readable text.
 * Resolved against the recipient's own locale, the same as the email that
 * accompanies it (docs ADR 20260731-per-person-notification-locale) — no
 * downstream renderer picks words for a sent text, so this composes its own
 * via `t()` rather than returning a code (docs ADR
 * 20260731-notification-locale, whose terminal-renderer exception stands).
 */
function reminderSmsBody(
  t: DiverTranslator,
  locale: DiverLocale,
  input: {
    shopName: string;
    tripTitle: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    lead: "week" | "day";
    dockCallMinutes: number;
    outstanding: ReminderActionCode[];
    medicalReview: boolean;
    forecast?: string | null;
    whoToText?: string | null;
    /** Whether this body may end with the reply line (ADR 20260909-reply-keywords). */
    replyKeywords?: boolean;
    /**
     * Unfinished course materials (ADR 20261008-course-learning-materials).
     * Their own clause under the materials heading, never the boarding to-do:
     * the eLearning is not something the boat checks.
     */
    materials?: CourseLearningMaterial[];
    /** A course session: it starts rather than sails, and names no dock. */
    courseSession?: boolean;
    /**
     * The departure's dive mode (`trips.dive_mode`). Only a boat leaves
     * without anyone, so only a boat's day-before text teaches LATE.
     */
    diveMode?: "boat" | "shore" | "pool";
  },
): string {
  const when =
    input.lead === "week" ? t("notifications.sms.whenWeek") : t("notifications.sms.whenDay");
  const date = formatShortDate(input.startsAt, locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, locale, input.timezone);
  const conditions =
    input.lead === "day" && input.forecast
      ? ` ${t("notifications.brief.conditionsLabel")} ${input.forecast}`
      : "";
  // Name the diver's own outstanding items rather than a generic nudge.
  const todo = input.outstanding.map((code) => reminderActionText(t, code));
  if (input.medicalReview) todo.push(t("notifications.sms.medicalReviewNote"));
  const todoText = todo.length
    ? ` ${t("notifications.common.outstandingHeading")} ${todo.join("; ")}.`
    : "";
  // A phone-only student has no email to click through, so the text carries
  // the first material's own https link. Never the readiness capability: no
  // reminder text carries one, and this is not the place to start.
  const materials = input.materials ?? [];
  const names = materials.map((material) => material.name).join("; ");
  const firstLink = materials.find((material) => material.url)?.url;
  const materialsText =
    materials.length === 0
      ? ""
      : ` ${
          firstLink
            ? t("notifications.sms.materialsWithLink", { names, url: firstLink })
            : t("notifications.sms.materials", { names })
        }`;
  const contact =
    input.lead === "day" && input.whoToText
      ? ` ${t("notifications.sms.contact", { phone: input.whoToText })}`
      : "";
  const body = input.courseSession
    ? t("notifications.sms.courseBody", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        when,
        date,
        time,
      })
    : t("notifications.sms.body", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        when,
        date,
        time,
        minutes: input.dockCallMinutes,
      });
  // **The night-before brief's text teaches LATE** (J3): both of the channels a text can
  // leave on hear it — WhatsApp through the reply keywords, platform SMS
  // through `/api/webhooks/sms` — and the morning of a boat is the one time a
  // diver needs it. Only on a boat (`dive_mode`), whatever else it is: a
  // shore or pool day has no departure to hold, and a course session at sea
  // does.
  const late =
    input.lead === "day" && input.diveMode === "boat"
      ? ` ${t("notifications.replyKeyword.lateOffer")}`
      : "";
  // Last, and only on a channel that can hear the answer.
  const keywords = input.replyKeywords ? ` ${t("notifications.replyKeyword.offer")}` : "";
  return `${body}${conditions}${todoText}${materialsText}${contact}${late}${keywords}`;
}

/**
 * Send every pre-trip reminder that has come due since the last run, across all
 * shops. Idempotent by construction: a booking's reminder is deduped by a
 * `notification_deliveries` row keyed on (booking, cadence kind), so re-running
 * only sends cadences not yet delivered (`src/lib/reminders.ts`). Email is the
 * tracked channel when the diver has one; a phone-only diver is tracked from
 * the courtesy-text result instead. When email is the tracked channel, a
 * textable phone also gets a courtesy text on success — the reminder's dedup row
 * then suppresses both channels next run.
 *
 * That courtesy text goes out over the shop's own WhatsApp when it has connected
 * one, and over platform SMS otherwise — one message either way, never both
 * (`src/lib/notifications/courtesy.ts`).
 *
 * **Due is not the same as worth sending** (issue #1177). Every due cadence is
 * put to `reminderEarnsItsSend` against the diver's own checklist: the 24-hour
 * dock reminder always passes, and the 7-day nudge is held back when the diver
 * has nothing left to do, counted as `settled`. That suppression writes no
 * delivery row, so it re-arms if a card lapses later in the same week.
 *
 * There is no timer in the app: a cron caller drives `now`
 * (docs ADR 20260721-scheduled-reminder-cadence). Fully degradable — with no
 * email or SMS provider configured every send records `not_configured` and the
 * staff notification dashboard surfaces it, exactly like every other channel.
 */
export async function sendDueReminders(
  db: AppDb,
  options: SendDueRemindersOptions = {},
): Promise<ReminderRunSummary> {
  const now = options.now ?? nowDate();
  const emailProvider = notificationProviderForDb(options.emailProvider);
  const smsProvider = stopListedSmsProvider(
    db,
    options.smsProvider ?? smsProviderFromEnvironment(),
  );
  const origin = options.appOrigin === undefined ? publicAppUrl() : options.appOrigin;
  // Whether a diver replying to this mail reaches DiveDay at all. The
  // `Reply-To` is a routable per-shop address only when a receiving domain is
  // configured (ADR 20260907-two-way-inbox decision 3); without one, replies
  // go to the shop's front desk and a line offering `C` would be a promise the
  // app cannot keep.
  const inboundEmailOn = Boolean(inboundEmailDomain());
  const horizon = new Date(now.getTime() + MAX_REMINDER_LEAD_HOURS * HOUR_MS);

  const rows = await db
    .select({
      booking: bookings,
      person: people,
      trip: trips,
      shop: shops,
      // A course session's learning materials (ADR
      // 20261008-course-learning-materials); null on a fun dive. Joined on the
      // shop as well as the id, so a course row can only ever be this trip's
      // own shop's.
      courseMaterials: courses.learningMaterials,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, trips.shopId)))
    .where(
      and(
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        lte(trips.startsAt, horizon),
      ),
    );

  const summary: ReminderRunSummary = {
    scanned: rows.length,
    sent: 0,
    skipped: 0,
    held: 0,
    identityHeld: 0,
    settled: 0,
    failed: 0,
  };
  if (rows.length === 0) return summary;

  // Resolved once for every shop in this scan rather than per booking — the
  // cron sweeps all shops at once, so a per-booking lookup would be an N+1
  // against a table that fits in a single query.
  const whatsAppProviders =
    options.whatsAppProviders ??
    (await whatsAppProvidersForShops(
      db,
      rows.map((row) => row.shop.id),
    ));

  // Which reminder cadences have already landed for these bookings.
  const bookingIds = rows.map((r) => r.booking.id);
  const delivered = await db
    .select({ bookingId: notificationDeliveries.bookingId, kind: notificationDeliveries.kind })
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.bookingId, bookingIds),
        inArray(notificationDeliveries.kind, REMINDER_KINDS),
        eq(notificationDeliveries.status, "sent"),
      ),
    );
  const sentByBooking = new Map<string, Set<string>>();
  for (const row of delivered) {
    const set = sentByBooking.get(row.bookingId) ?? new Set<string>();
    set.add(row.kind);
    sentByBooking.set(row.bookingId, set);
  }

  // Who has dived with the shop before — a night-before brief speaks to a
  // first-timer (anyone NOT in this set) in a softer voice (brainstorm C).
  const returning = await returningDiverIds(db, [...new Set(rows.map((r) => r.person.id))], now);

  const emailWork: Array<{
    bookingId: string;
    shopId: string;
    shopName: string;
    kind: ReminderKind;
    phone: string | null;
    smsBody: string;
    smsStopLine: string;
    whatsAppBody: string;
    notification: Notification;
  }> = [];
  const smsWork: Array<{
    bookingId: string;
    shopId: string;
    shopName: string;
    kind: ReminderKind;
    phone: string;
    smsBody: string;
    smsStopLine: string;
    whatsAppBody: string;
  }> = [];

  // Which cadence, if any, each booking is due for — decided up front so the
  // readiness batch below only covers trips with something to send.
  const dueRows: Array<{
    row: (typeof rows)[number];
    cadence: NonNullable<ReturnType<typeof dueReminder>>;
  }> = [];
  for (const row of rows) {
    const cadence = dueReminder({
      startsAt: row.trip.startsAt,
      now,
      sentKinds: sentByBooking.get(row.booking.id) ?? new Set(),
    });
    if (!cadence) {
      summary.skipped += 1;
      continue;
    }
    // **A held seat waits for staff** (#2082). Until someone confirms the
    // booker is the diver record the seat was matched to, the address on that
    // record may be somebody else's, and a reminder would hand them this
    // seat's link. The cadence re-arms the moment the hold clears, because no
    // delivery row is written for it. Staff are told on the roster's held-seat
    // row and Today's identity row ("Reminders wait…", issue #2124), so the
    // desk can confirm ahead of the day.
    if (row.booking.identityUnconfirmedAt) {
      summary.identityHeld += 1;
      continue;
    }
    // **Due is not the same as sendable.** A fixed 14:00 UTC batch reached
    // Singapore at 22:00, Sydney at midnight and Fiji at 03:00 — every day, to
    // every diver sailing tomorrow (issue #697). Held, not dropped: this pass
    // runs hourly and a cadence bucket is hours wide (the 24-hour reminder is
    // due from T-24h right up to departure, and any 24-hour span contains a
    // whole daytime window), so skipping the quiet passes cannot close it.
    if (!maySendNow(cadence.kind, now, row.shop.timezone)) {
      summary.held += 1;
      continue;
    }
    dueRows.push({ row, cadence });
  }

  // One batched readiness pass per shop, the same call Today and check-in
  // make — not a full-roster recompute per booking. The night before a full
  // boat every seat on it comes due at once, and the per-booking detail read
  // re-derives the whole trip's readiness (~a dozen queries) each time.
  const dueTripsByShop = new Map<string, Set<string>>();
  for (const { row } of dueRows) {
    const set = dueTripsByShop.get(row.shop.id) ?? new Set<string>();
    set.add(row.trip.id);
    dueTripsByShop.set(row.shop.id, set);
  }
  const readinessByBooking = new Map<
    string,
    Awaited<ReturnType<typeof listTripsReadiness>>[number]
  >();
  await Promise.all(
    [...dueTripsByShop].map(async ([shopId, tripIds]) => {
      for (const row of await listTripsReadiness(db, shopId, [...tripIds], now)) {
        readinessByBooking.set(row.booking.id, row);
      }
    }),
  );

  // Every meeting of each due trip, in day order — one read for the whole
  // pass. A multi-day course's reminder lists each day; one meeting (or none
  // on file) keeps the single date and time it always had.
  const dueTripIds = [...new Set(dueRows.map(({ row }) => row.trip.id))];
  const meetingsByTrip = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  if (dueTripIds.length > 0) {
    const meetings = await db
      .select({
        tripId: tripScheduleDays.tripId,
        startsAt: tripScheduleDays.startsAt,
        endsAt: tripScheduleDays.endsAt,
      })
      .from(tripScheduleDays)
      .where(inArray(tripScheduleDays.tripId, dueTripIds))
      .orderBy(asc(tripScheduleDays.tripId), asc(tripScheduleDays.dayNumber));
    for (const meeting of meetings) {
      const list = meetingsByTrip.get(meeting.tripId) ?? [];
      list.push({ startsAt: meeting.startsAt, endsAt: meeting.endsAt });
      meetingsByTrip.set(meeting.tripId, list);
    }
  }

  for (const {
    row: { booking, person, trip, shop, courseMaterials },
    cadence,
  } of dueRows) {
    // The diver's own checklist, from the same engine their readiness page
    // reads — built first because the rhythm rule (issue #1177) decides on it
    // whether anything below runs at all.
    const evidence = readinessByBooking.get(booking.id);
    const checklist = evidence
      ? buildDiverChecklist(evidence.requirement, evidence.readiness)
      : null;
    // A course student's learning materials ride the week-out nudge until a
    // staffer marks them done (ADR 20261008-course-learning-materials). They
    // are a to-do of their own, so they also keep that nudge from being
    // suppressed as settled; the night-before brief never repeats them.
    // "Done" is the person's, across every departure of the course
    // (`courseMaterialsDoneByPerson`), so a tick on the pool weekend quiets
    // the open-water weekend's nudge too.
    const courseMaterialsList =
      cadence.kind === "trip_reminder_7d" && trip.courseId && !booking.courseMaterialsDoneAt
        ? readLearningMaterials(courseMaterials)
        : [];
    const materialsDue =
      trip.courseId &&
      courseMaterialsList.length > 0 &&
      !(
        await courseMaterialsDoneByPerson(db, {
          shopId: shop.id,
          courseId: trip.courseId,
          personIds: [person.id],
          around: trip.startsAt,
        })
      ).has(person.id)
        ? courseMaterialsList
        : [];
    const meetings = meetingsByTrip.get(trip.id) ?? [];

    // **Due, sendable, and still not worth sending.** The 7-day nudge carries
    // the diver's to-do list and nothing else, so with nothing on it there is
    // no message to send. Checked *before* `issueBookingCapability` below, so a
    // suppressed reminder does not mint a readiness token nobody will open, and
    // before the no-reachable-channel branch, so a settled diver with no email
    // and no phone is counted settled rather than failed. Nothing is written:
    // the un-sent cadence is what re-arms the nudge if a card lapses later in
    // the same week-wide bucket.
    if (
      !reminderEarnsItsSend(cadence.kind, checklist, {
        courseMaterialsDue: materialsDue.length > 0,
      })
    ) {
      summary.settled += 1;
      continue;
    }

    const lead = cadence.kind === "trip_reminder_7d" ? "week" : "day";
    // There is no request to negotiate `Accept-Language` from at a cron fire,
    // so this reads whatever the diver's own past requests already recorded,
    // and falls back to the shop's stored locale when there is nothing — same
    // fallback the calendar feed uses, for the same reason (docs ADR
    // 20260731-per-person-notification-locale). Both the email and the SMS
    // below take this one value, so a diver never gets the two channels in
    // different languages.
    const locale = recipientLocale(person.locale, shop.defaultLocale);
    const t = diverTranslator(locale);
    const readinessCapability = origin
      ? await issueBookingCapability(db, {
          shopId: shop.id,
          bookingId: booking.id,
          purpose: "readiness",
          now,
        })
      : null;
    const readinessUrl = readinessCapability
      ? new URL(readinessLinkPath(readinessCapability.token), `${origin}/`).toString()
      : undefined;
    const phone = smsRecipient(person.phone);

    // Name the diver's own outstanding items from that same checklist, so the
    // reminder never diverges from the readiness engine — and so the rule above
    // and the words below cannot be reading two different answers.
    const { outstanding, medicalReview } = checklist
      ? reminderReadiness(checklist)
      : { outstanding: [], medicalReview: false };

    // The night-before (day) lead becomes the full brief: plain-language
    // conditions from the crew, what to bring, who to text, and a softer voice
    // for a first-timer. The 7-day nudge carries none of it.
    const isDay = cadence.kind === "trip_reminder_24h";
    const forecast = isDay
      ? forecastText(
          t,
          locale,
          {
            conditionsSummary: trip.conditionsSummary,
            waterTemperatureC: trip.waterTemperatureC,
            visibilityMeters: trip.visibilityMeters,
            surfaceConditions: trip.surfaceConditions,
          },
          // Written in the shop's own units, so the brief agrees with the trip
          // page the diver opens from it (src/lib/temperature-units.ts,
          // src/lib/depth-units.ts). Storage stays Celsius and metres.
          { temperature: temperatureUnitFor(shop), depth: shop.depthUnit },
        )
      : null;
    const whoToText = isDay ? shop.contactPhone?.trim() || null : null;
    const brief = isDay
      ? {
          forecast,
          bring: shop.packingList,
          whoToText,
          firstTimerNote: firstTimerReassuranceText(t, !returning.has(person.id)),
        }
      : undefined;

    const reminderText = (replyKeywords: boolean) =>
      reminderSmsBody(t, locale, {
        shopName: shop.name,
        tripTitle: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        timezone: shop.timezone,
        lead,
        dockCallMinutes: shop.dockCallMinutes,
        outstanding,
        medicalReview,
        forecast,
        whoToText,
        replyKeywords,
        materials: materialsDue,
        courseSession: Boolean(trip.courseId),
        diveMode: trip.diveMode,
      });
    const smsBody = reminderText(false);
    // The same reminder, plus the reply line, for the one text channel that
    // can hear an answer. Which of the two actually goes out is
    // `sendCourtesyMessage`'s call, and it may still fall back to SMS after a
    // failed WhatsApp send — which is exactly why both bodies travel together
    // rather than one being chosen here (ADR 20260909-reply-keywords).
    const whatsAppBody = reminderText(true);

    if (person.email) {
      emailWork.push({
        bookingId: booking.id,
        shopId: shop.id,
        shopName: shop.name,
        kind: cadence.kind,
        phone,
        smsBody,
        smsStopLine: t("notifications.sms.stopLine"),
        whatsAppBody,
        notification: {
          kind: cadence.kind,
          bookingId: booking.id,
          shopId: shop.id,
          to: person.email,
          locale,
          diverName: person.fullName,
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
          timezone: shop.timezone,
          dockCallMinutes: shop.dockCallMinutes,
          pickupTime: booking.pickupTime,
          hotelPickupLocation: booking.hotelPickupLocation,
          outstanding,
          medicalReview,
          readinessUrl,
          ...(inboundEmailOn ? { replyKeywords: true } : {}),
          ...(brief ? { brief } : {}),
          ...(materialsDue.length > 0 ? { learningMaterials: materialsDue } : {}),
          ...(meetings.length > 1 ? { scheduleDays: meetings } : {}),
          ...(trip.courseId ? { courseSession: true } : {}),
        },
      });
    } else if (phone) {
      smsWork.push({
        bookingId: booking.id,
        shopId: shop.id,
        shopName: shop.name,
        kind: cadence.kind,
        phone,
        smsBody,
        smsStopLine: t("notifications.sms.stopLine"),
        whatsAppBody,
      });
    } else {
      // No reachable channel — record it so staff can see the gap.
      await recordNotificationDelivery(db, {
        shopId: shop.id,
        bookingId: booking.id,
        kind: cadence.kind,
        delivery: { status: "not_configured" },
      });
      summary.failed += 1;
    }
  }

  const emailDeliveries = await sendNotificationBatch(
    db,
    emailWork.map((work) => work.notification),
    emailProvider,
  );
  for (let index = 0; index < emailWork.length; index += 1) {
    const work = emailWork[index];
    const delivery = emailDeliveries[index] ?? { status: "failed" as const, retryable: true };
    // A textable phone gets a courtesy text only when the email actually sent,
    // so the once-per-booking dedup row keeps it from re-firing next run. Its
    // outcome is deliberately not recorded: email is the tracked channel here,
    // and a courtesy text that failed must not overwrite a delivered email.
    if (delivery.status === "sent" && work.phone) {
      await sendCourtesyMessage(
        {
          to: work.phone,
          body: work.smsBody,
          smsStopLine: work.smsStopLine,
          whatsAppBody: work.whatsAppBody,
          shopName: work.shopName,
        },
        { sms: smsProvider, whatsapp: whatsAppProviders.get(work.shopId) ?? null },
      );
    }
    await recordNotificationDelivery(db, {
      shopId: work.shopId,
      bookingId: work.bookingId,
      kind: work.kind,
      delivery,
    });
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  for (const work of smsWork) {
    // Phone-only diver: the courtesy text is the tracked channel, whichever of
    // WhatsApp or SMS carried it. CourtesyDelivery is the same shape as
    // NotificationDelivery, so it records through the same seam.
    const { delivery } = await sendCourtesyMessage(
      {
        to: work.phone,
        body: work.smsBody,
        smsStopLine: work.smsStopLine,
        whatsAppBody: work.whatsAppBody,
        shopName: work.shopName,
      },
      { sms: smsProvider, whatsapp: whatsAppProviders.get(work.shopId) ?? null },
    );
    await recordNotificationDelivery(db, {
      shopId: work.shopId,
      bookingId: work.bookingId,
      kind: work.kind,
      delivery,
    });
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
