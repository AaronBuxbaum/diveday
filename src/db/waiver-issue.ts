import { and, eq, isNull } from "drizzle-orm";
import { courseFormsLinkPath, readinessWaiverLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { log } from "@/lib/log";
import {
  type NotificationProvider,
  notificationProviderSignal,
  publicAppUrl,
  recipientLocale,
  waiverLinkText,
} from "@/lib/notifications";
import { type CourtesyProviders, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import { smsProviderFromEnvironment, smsRecipient } from "@/lib/notifications/sms";
import { hasLiveDeliveredReadinessLink, issueBookingCapability } from "./booking-capabilities";
import { mintCapability } from "./capabilities";
import type { AppDb, DbExecutor } from "./client";
import { getCourseFormsForBooking } from "./course-forms";
import {
  withErasureCoordinatedBookingSend,
  withErasureCoordinatedPersonSend,
} from "./erasure-coordinated-send";
import { retryBookingConfirmation, sendAndRecordNotification } from "./notifications";
import { isTransactionExecutor } from "./query-helpers";
import { getBookingReadiness } from "./readiness";
import { bookings, people, shops, trips, waiverRecords } from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { liveTrip } from "./trips-live";
import { seatNotCancelled } from "./trips-queries";
import {
  hasLivePersonWaiverRequest,
  issueWaiverRequest,
  openWaiverInThread,
  recordWaiverDelivery,
  staleWaiverRecordForToken,
} from "./waivers";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/**
 * The one place that issues a waiver link *and* delivers it. Both the trip
 * roster and the Today/Blockers one-tap sends call this so a waiver is never
 * issued by a different rule in two places (the transaction lives in
 * `issueWaiverRequest`; this wraps it with delivery and the context a notice
 * needs). It is self-contained — given a shop and a booking it fetches the
 * diver, trip, and shop names itself — so a caller never threads snapshots
 * through hidden form fields.
 */

/**
 * Which way the shop asked DiveDay to hand the link over.
 *
 * `link` is not a degraded email: it is the staffer saying "give me the URL and
 * I will pass it on myself" — the counter conversation where the diver is
 * standing there with their phone out. So it attempts no delivery at all rather
 * than mailing a copy nobody asked for on its way to the clipboard.
 */
export type WaiverSendChannel = "email" | "sms" | "link";

/**
 * How the diver actually got (or did not get) their link. Anything that is not
 * `sent` means staff must hand over the fallback link themselves, so the UI
 * shows it rather than silently claiming an email is on its way.
 */
export type WaiverDelivery =
  | "sent"
  | "no_email"
  /** Asked to text, but the record carries no internationally dialable number. */
  | "no_phone"
  /** No `APP_HOST`, so there is no origin to build the link on — nothing was attempted. */
  | "no_app_origin"
  | "unconfigured"
  | "test_recipient"
  | "failed"
  /** The `link` channel: issued on purpose with nothing sent, so staff can pass it on. */
  | "link_only"
  /**
   * The `link` channel on a seat: refused. A seat's release is its holder's
   * thread link, which only ever goes to the contact on file (issue #2743).
   */
  | "thread_only";

/**
 * The shop's own text senders, resolved once per send.
 *
 * Injectable so a test can drive both halves without AWS or Meta credentials,
 * and so the one rule that prefers a shop's own WhatsApp over platform SMS
 * (`sendCourtesyMessage`) stays in the one place that owns it.
 */
async function waiverTextProviders(db: DbExecutor, shopId: string): Promise<CourtesyProviders> {
  const senders = await whatsAppProvidersForShops(db, [shopId]);
  return {
    sms: stopListedSmsProvider(db, smsProviderFromEnvironment()),
    whatsapp: senders.get(shopId) ?? null,
  };
}

/**
 * Text one diver their waiver link over the shop's own WhatsApp when it has
 * connected one, and platform SMS otherwise — one message either way, never
 * both (`src/lib/notifications/courtesy.ts`).
 */
async function textWaiverLink(
  db: DbExecutor,
  input: {
    shopId: string;
    phone: string | null;
    shopName: string;
    tripTitle?: string;
    locale: string;
    completionUrl: string;
    providers?: CourtesyProviders;
    signal?: AbortSignal;
    /** The course-forms text rather than the release's (ADR 20261008-course-forms). */
    courseForms?: boolean;
  },
): Promise<{ delivery: WaiverDelivery; providerMessageId?: string }> {
  const to = smsRecipient(input.phone);
  if (!to) return { delivery: "no_phone" };
  const providers = input.providers ?? (await waiverTextProviders(db, input.shopId));
  const { delivery } = await sendCourtesyMessage(
    {
      to,
      shopName: input.shopName,
      body: waiverLinkText(input),
      locale: input.locale,
    },
    providers,
    { signal: input.signal ?? notificationProviderSignal() },
  );
  if (delivery.status === "sent") {
    return { delivery: "sent", providerMessageId: delivery.providerMessageId };
  }
  return { delivery: delivery.status === "not_configured" ? "unconfigured" : "failed" };
}

/**
 * What a `link`/`text` send should write to the record's delivery columns.
 *
 * A copied link is recorded `sent`: those columns answer "does the diver have a
 * live link", and a staffer taking the URL to hand over *is* that handover. The
 * alternative — leaving them null — makes `getDiverWaiverRequestStatus` report a
 * failed delivery, so the card would show "Failed to deliver" about a send
 * nobody attempted or wanted.
 */
function recordedDeliveryStatus(delivery: WaiverDelivery): "sent" | "failed" | "not_configured" {
  if (delivery === "sent" || delivery === "link_only") return "sent";
  if (delivery === "unconfigured") return "not_configured";
  return "failed";
}

export type IssueAndDeliverWaiverResult =
  | {
      ok: true;
      bookingId: string;
      diverName: string;
      /**
       * The bearer link (token path) to hand over when delivery was not `sent`.
       * Null for a seat's release: its link is the holder's thread link and
       * never comes back to staff (issue #2743).
       */
      token: string | null;
      /**
       * The link's path when it is not `/waivers/<token>`: the release was
       * already signed and the course's forms were not, so what went out (or
       * is to be handed over) is the student's forms page on their readiness
       * link (ADR 20261008-course-forms). Absent for every release link.
       */
      path?: string;
      delivery: WaiverDelivery;
    }
  | {
      ok: false;
      bookingId: string;
      /** Best-effort name for the notice; null only when the booking is gone. */
      diverName: string | null;
      reason: "already_completed" | "error";
    };

export type PersonWaiverResult =
  | (Omit<Extract<IssueAndDeliverWaiverResult, { ok: true }>, "bookingId" | "token"> & {
      bookingId: null;
      /** A bookingless release keeps its waiver link (ADR 20261105). */
      token: string;
    })
  | (Omit<Extract<IssueAndDeliverWaiverResult, { ok: false }>, "bookingId"> & { bookingId: null });

/** Which channel to hand the link over on, plus test seams for the text one. */
export type WaiverDeliveryOptions = {
  /** Defaults to `email`, which is every caller that predates the channel. */
  channel?: WaiverSendChannel;
  /** Injected text senders, so a test never needs AWS or Meta credentials. */
  textProviders?: CourtesyProviders;
  /** Provider seam for booking-bound confirmation and waiver emails. */
  provider?: NotificationProvider;
  /**
   * The instant to issue against, threaded down to `issueWaiverRequest`.
   *
   * It matters now that a live link is reused rather than replaced: whether the
   * diver already holds a signable link is a question about a moment, and a
   * caller that has one (`emailFreshWaiverLink` decides "is this URL stale?"
   * against its own `now`) must not have the issuing half silently answer it
   * against a different one. Defaults to the clock, which is every other caller.
   */
  now?: Date;
  /** Identity read before a booking-bound send; stale assignments are refused. */
  expectedPersonId?: string;
  expectedTripId?: string;
};

/**
 * **The release is signed; the course's forms are not** (ADR
 * 20261008-course-forms). Get this enrollment's forms-only link and hand
 * it over on the asked-for channel, by the same rules as the
 * release's own link: best-effort, and anything not `sent` comes back for the
 * staffer to pass on. Null when no form is owed, the seat is held for staff to
 * confirm who it is, or the booking cannot carry a link — the caller then
 * reports the release as already signed, which is the whole truth.
 */
async function deliverCourseFormsLink(
  db: DbExecutor,
  ctx: {
    person: typeof people.$inferSelect;
    trip: typeof trips.$inferSelect;
    shop: typeof shops.$inferSelect;
  },
  bookingId: string,
  options: WaiverDeliveryOptions,
  expectedTripId: string,
): Promise<IssueAndDeliverWaiverResult | null> {
  const shopId = ctx.shop.id;
  const forms = await getCourseFormsForBooking(db, shopId, bookingId);
  if (!forms || forms.outstanding.length === 0 || forms.enrollment.identityHeld) return null;
  // A forms-only link, and the live one when the diver already holds it:
  // never the readiness link, which would also open the diver's whole trip
  // prep to whoever the URL is handed to (security review).
  const issued = await issueBookingCapability(db, {
    shopId,
    bookingId,
    purpose: "course_forms",
    expectedPersonId: ctx.person.id,
    expectedTripId,
    now: options.now,
  });
  if (!issued) return null;
  const path = courseFormsLinkPath(issued.token);
  const origin = publicAppUrl();
  const url = origin ? new URL(path, `${origin}/`).toString() : null;
  // A rehearsal sends nothing (ADR 20261012-rehearsal-departures): the link is
  // still issued, for the staffer to hand over in person.
  const channel = ctx.trip.isRehearsal ? "link" : (options.channel ?? "email");
  const locale = recipientLocale(ctx.person.locale, ctx.shop.defaultLocale);
  let delivery: WaiverDelivery = "no_app_origin";
  if (!url) {
    delivery = "no_app_origin";
  } else if (channel === "link") {
    delivery = "link_only";
  } else if (channel === "sms") {
    delivery = (
      await textWaiverLink(db, {
        shopId,
        phone: ctx.person.phone,
        shopName: ctx.shop.name,
        tripTitle: ctx.trip.title,
        locale,
        completionUrl: url,
        providers: options.textProviders,
        courseForms: true,
        signal: notificationProviderSignal(),
      })
    ).delivery;
  } else if (!ctx.person.email) {
    delivery = "no_email";
  } else {
    const result = await sendAndRecordNotification(
      db,
      {
        kind: "readiness_link",
        purpose: "course_forms",
        bookingId,
        shopId,
        to: ctx.person.email,
        locale,
        diverName: ctx.person.fullName,
        shopName: ctx.shop.name,
        tripTitle: ctx.trip.title,
        readinessUrl: url,
        expiresAt: issued.expiresAt,
        timezone: ctx.shop.timezone,
      },
      { provider: options.provider, signal: notificationProviderSignal() },
    );
    delivery = emailDelivery(result);
  }
  return {
    ok: true,
    bookingId,
    diverName: ctx.person.fullName,
    token: issued.token,
    path,
    delivery,
  };
}

/** What an email send came to, in the words a waiver send reports. */
function emailDelivery(
  result: Awaited<ReturnType<typeof sendAndRecordNotification>>,
): WaiverDelivery {
  if (result.status === "sent") return "sent";
  if (result.status === "not_configured") return "unconfigured";
  return result.errorCode === "invalid_test_recipient" ? "test_recipient" : "failed";
}

/**
 * **Hand a seat's release to its holder as their thread link** (issue #2743,
 * ADR 20261105-waiver-folds-into-the-thread). The link is
 * `/ready/<token>/waiver` on the seat's delivered readiness capability: the
 * one the booking confirmation carried, so a second send is the same URL.
 *
 * That capability also pays, cancels and moves the seat, so it goes only to
 * the address or number on file, and is minted only once there is one to
 * send to. It never comes back to the caller: there is no Copy link for a
 * seat (`thread_only`), and a send that did not land hands staff nothing to
 * pass on (security review of layer 1, "Copy link"). Null when the
 * capability is refused (the holder was erased or the seat moved under it).
 */
async function deliverThreadLink(
  tx: DbExecutor,
  input: {
    ctx: {
      person: typeof people.$inferSelect;
      trip: typeof trips.$inferSelect;
      shop: typeof shops.$inferSelect;
    };
    bookingId: string;
    waiverRecordId: string;
    expectedPersonId: string;
    expectedTripId: string;
    options: WaiverDeliveryOptions;
  },
): Promise<WaiverDelivery | null> {
  const { ctx, options } = input;
  const shopId = ctx.shop.id;
  // A rehearsal sends nothing (ADR 20261012-rehearsal-departures), and a
  // seat's link is never one a staffer copies: the counter tablet or paper
  // is how a diver standing there signs.
  const channel = ctx.trip.isRehearsal ? "link" : (options.channel ?? "email");
  if (channel === "link") return "thread_only";
  const origin = publicAppUrl();
  const locale = recipientLocale(ctx.person.locale, ctx.shop.defaultLocale);
  const record = async (delivery: WaiverDelivery, providerMessageId?: string) => {
    await recordWaiverDelivery(tx, {
      shopId,
      waiverRecordId: input.waiverRecordId,
      channel,
      delivery: { status: recordedDeliveryStatus(delivery), providerMessageId },
      now: options.now,
    });
    return delivery;
  };
  if (!origin) return record("no_app_origin");
  if (channel === "sms" && !smsRecipient(ctx.person.phone)) return record("no_phone");
  const email = ctx.person.email;
  if (channel === "email" && !email) return record("no_email");
  const issued = await issueBookingCapability(tx, {
    shopId,
    bookingId: input.bookingId,
    purpose: "readiness",
    expectedPersonId: input.expectedPersonId,
    expectedTripId: input.expectedTripId,
    now: options.now,
    delivered: true,
  });
  if (!issued) return null;
  const url = new URL(readinessWaiverLinkPath(issued.token), `${origin}/`).toString();
  if (channel === "sms") {
    const texted = await textWaiverLink(tx, {
      shopId,
      phone: ctx.person.phone,
      shopName: ctx.shop.name,
      tripTitle: ctx.trip.title,
      locale,
      completionUrl: url,
      providers: options.textProviders,
      signal: notificationProviderSignal(),
    });
    return record(texted.delivery, texted.providerMessageId);
  }
  if (!email) return record("no_email");
  const mailed = await sendAndRecordNotification(
    tx,
    {
      kind: "waiver_request",
      waiverRecordId: input.waiverRecordId,
      bookingId: input.bookingId,
      shopId,
      to: email,
      locale,
      diverName: ctx.person.fullName,
      shopName: ctx.shop.name,
      tripTitle: ctx.trip.title,
      completionUrl: url,
      expiresAt: issued.expiresAt,
      timezone: ctx.shop.timezone,
    },
    { provider: options.provider, signal: notificationProviderSignal() },
  );
  return record(
    emailDelivery(mailed),
    mailed.status === "sent" ? mailed.providerMessageId : undefined,
  );
}

/**
 * Hand a seat's release over: opened for the holder's thread
 * (`openWaiverInThread`) and sent as their thread link on the asked-for
 * channel (`deliverThreadLink`); the course's forms link when the release is
 * already signed. Delivery is best-effort: a missing address or number,
 * missing app origin, or a failed/disabled provider all resolve to a
 * non-`sent` delivery, and no seat's link comes back to hand over.
 */
export async function issueAndDeliverWaiver(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  options: WaiverDeliveryOptions = {},
): Promise<IssueAndDeliverWaiverResult> {
  const [observed] = await db
    .select({ person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), seatNotCancelled))
    .limit(1);
  if (!observed || (options.expectedPersonId && observed.person.id !== options.expectedPersonId)) {
    return { ok: false, bookingId, diverName: null, reason: "error" };
  }

  const fenced = await withErasureCoordinatedBookingSend<IssueAndDeliverWaiverResult | null>(
    db,
    {
      shopId,
      bookingId,
      expectedPersonId: observed.person.id,
      expectedTripId: options.expectedTripId ?? observed.trip.id,
      expectedEmail: observed.person.email,
      expectedPhone: observed.person.phone,
    },
    async (tx) => {
      const [ctx] = await tx
        .select({ person: people, trip: trips, shop: shops })
        .from(bookings)
        .innerJoin(
          people,
          and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)),
        )
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
        .innerJoin(shops, eq(shops.id, bookings.shopId))
        .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), seatNotCancelled))
        .limit(1);
      if (!ctx) return null;

      const expectedPersonId = options.expectedPersonId ?? observed.person.id;
      const expectedTripId = options.expectedTripId ?? observed.trip.id;
      // The seat's release is opened for its holder's thread (issue #2743):
      // a live record is kept, so a waiver link a staffer sent earlier and the
      // draft typed into it survive this send.
      const opened = await openWaiverInThread(tx, {
        shopId,
        bookingId,
        expectedPersonId,
        expectedTripId,
        now: options.now,
      });
      if (!opened.ok && opened.reason === "already_completed") {
        // The release is signed. A course may still ask for its own forms, and the
        // shop's one "send the waiver" act covers them too — so it hands over the
        // student's forms page instead of reporting nothing to send.
        const forms = await deliverCourseFormsLink(tx, ctx, bookingId, options, observed.trip.id);
        if (forms) return forms;
      }
      if (!opened.ok) {
        return {
          ok: false,
          bookingId,
          diverName: ctx.person.fullName,
          reason: opened.reason === "already_completed" ? "already_completed" : "error",
        };
      }
      const delivered = await deliverThreadLink(tx, {
        ctx,
        bookingId,
        waiverRecordId: opened.recordId,
        expectedPersonId,
        expectedTripId,
        options,
      });
      if (!delivered) return null;
      return {
        ok: true,
        bookingId,
        diverName: ctx.person.fullName,
        token: null,
        delivery: delivered,
      };
    },
  );
  return fenced ?? { ok: false, bookingId, diverName: null, reason: "error" };
}

/**
 * The same, for a diver directly, with no booking or schedule required — so two
 * sends from their record hand over one link rather than two.
 */
export async function issueAndDeliverPersonWaiver(
  db: AppDb,
  shopId: string,
  personId: string,
  options: WaiverDeliveryOptions = {},
): Promise<PersonWaiverResult> {
  const [observed] = await db
    .select({ person: people, shop: shops })
    .from(people)
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .limit(1);
  if (!observed) return { ok: false, bookingId: null, diverName: null, reason: "error" };
  const fenced = await withErasureCoordinatedPersonSend(
    db,
    {
      shopId,
      personId,
      expectedEmail: observed.person.email,
      expectedPhone: observed.person.phone,
    },
    async (tx) => {
      const [ctx] = await tx
        .select({ person: people, shop: shops })
        .from(people)
        .innerJoin(shops, eq(shops.id, people.shopId))
        .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
        .limit(1);
      if (!ctx) return null;
      const outcome = await issueWaiverRequest(tx, {
        shopId,
        personId,
        expectedPersonId: personId,
        now: options.now,
      });
      if (!outcome.ok) {
        return {
          ok: false as const,
          bookingId: null,
          diverName: ctx.person.fullName,
          reason:
            outcome.reason === "already_completed"
              ? ("already_completed" as const)
              : ("error" as const),
        };
      }
      const origin = publicAppUrl();
      const channel = options.channel ?? "email";
      const completionUrl = origin
        ? new URL(`/waivers/${outcome.token}`, `${origin}/`).toString()
        : null;
      let delivery: WaiverDelivery = "no_app_origin";
      let providerMessageId: string | undefined;
      if (!completionUrl) {
        delivery = "no_app_origin";
      } else if (channel === "link") {
        delivery = "link_only";
      } else if (channel === "sms") {
        const result = await textWaiverLink(tx, {
          shopId,
          phone: ctx.person.phone,
          shopName: ctx.shop.name,
          locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
          completionUrl,
          providers: options.textProviders,
          signal: notificationProviderSignal(),
        });
        delivery = result.delivery;
        providerMessageId = result.providerMessageId;
      } else if (!ctx.person.email) {
        delivery = "no_email";
      } else {
        const result = await sendAndRecordNotification(
          tx,
          {
            kind: "waiver_request",
            waiverRecordId: outcome.recordId,
            shopId,
            to: ctx.person.email,
            locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
            diverName: ctx.person.fullName,
            shopName: ctx.shop.name,
            completionUrl,
            expiresAt: outcome.expiresAt,
            timezone: ctx.shop.timezone,
          },
          { provider: options.provider, signal: notificationProviderSignal() },
        );
        providerMessageId = result.status === "sent" ? result.providerMessageId : undefined;
        delivery = emailDelivery(result);
      }
      await recordWaiverDelivery(tx, {
        shopId,
        waiverRecordId: outcome.recordId,
        channel,
        delivery: { status: recordedDeliveryStatus(delivery), providerMessageId },
        now: options.now,
      });
      return {
        ok: true as const,
        bookingId: null,
        diverName: ctx.person.fullName,
        token: outcome.token,
        delivery,
      };
    },
  );
  return (
    fenced ?? { ok: false, bookingId: null, diverName: observed.person.fullName, reason: "error" }
  );
}

/**
 * Send a waiver the moment a diver joins a dive — but only when one is actually
 * needed. "Needed" is exactly the readiness engine's `waiver_not_sent` blocker
 * (or `waiver_lapsed`, its twin for a diver whose signature ran out):
 * the trip requires a waiver, the diver has no current signature carried forward
 * (sign-once), and none has been issued yet. Reusing that decision keeps the
 * join-send from ever emailing a redundant link to a diver who already signed,
 * or issuing on a trip that gates no waiver. Returns null when nothing was sent.
 *
 * Idempotent by construction: a second call finds a `waiver_pending` blocker
 * (not `waiver_not_sent`) and skips, so a retried join never stacks links.
 */
export async function issueWaiverOnJoin(
  db: AppDb,
  shopId: string,
  bookingId: string,
  identity: { expectedPersonId?: string; expectedTripId?: string } = {},
): Promise<IssueAndDeliverWaiverResult | null> {
  if (!(await joinWaiverOwed(db, shopId, bookingId))) return null;
  return issueAndDeliverWaiver(db, shopId, bookingId, identity);
}

/**
 * **A party member's release, sent as a waiver-only door** (issue #3986,
 * decision 2026-11-06). The lead typed this member's address, so what goes to
 * it opens the member's own release and nothing else: a `party_waiver_link`
 * (`/waivers/<token>`), never the seat's readiness link, which also pays,
 * cancels and moves the seat. Owed by the same rule as `issueWaiverOnJoin`;
 * email only, and nothing on a rehearsal. The token never comes back to the
 * caller. Null when nothing is owed. A minor's seat gets no door at all
 * (`thread_only`): their release needs a guardian the address cannot prove.
 */
export async function issuePartyMemberWaiverOnJoin(
  db: AppDb,
  shopId: string,
  bookingId: string,
  identity: { expectedPersonId?: string; expectedTripId?: string } = {},
): Promise<IssueAndDeliverWaiverResult | null> {
  if (!(await joinWaiverOwed(db, shopId, bookingId))) return null;
  const [observed] = await db
    .select({ person: people, trip: trips })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), seatNotCancelled))
    .limit(1);
  if (
    !observed ||
    (identity.expectedPersonId && observed.person.id !== identity.expectedPersonId) ||
    (identity.expectedTripId && observed.trip.id !== identity.expectedTripId)
  ) {
    return { ok: false, bookingId, diverName: null, reason: "error" };
  }
  const fenced = await withErasureCoordinatedBookingSend<IssueAndDeliverWaiverResult | null>(
    db,
    {
      shopId,
      bookingId,
      expectedPersonId: observed.person.id,
      expectedTripId: observed.trip.id,
      expectedEmail: observed.person.email,
      expectedPhone: observed.person.phone,
    },
    async (tx) => {
      const [ctx] = await tx
        .select({
          person: people,
          trip: trips,
          shop: shops,
          minorDeclaredAt: bookings.minorDeclaredAt,
        })
        .from(bookings)
        .innerJoin(
          people,
          and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)),
        )
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
        .innerJoin(shops, eq(shops.id, bookings.shopId))
        .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), seatNotCancelled))
        .limit(1);
      if (!ctx) return null;
      // A minor's release needs a parent or legal guardian, and whoever reads
      // this address could type both names. No door goes: the lead signs the
      // seat on their own link (`partySeatWaiverKey`), or the desk does with a
      // guardian present (issue #3986 reviews).
      if (
        guardianSignatureRequired(
          ctx.person.dateOfBirth,
          signingDate(nowDate(), ctx.shop.timezone),
          ctx.minorDeclaredAt !== null,
        )
      ) {
        return {
          ok: true,
          bookingId,
          diverName: ctx.person.fullName,
          token: null,
          delivery: "thread_only",
        };
      }
      const opened = await openWaiverInThread(tx, {
        shopId,
        bookingId,
        expectedPersonId: observed.person.id,
        expectedTripId: observed.trip.id,
      });
      if (!opened.ok) {
        return {
          ok: false,
          bookingId,
          diverName: ctx.person.fullName,
          reason: opened.reason === "already_completed" ? "already_completed" : "error",
        };
      }
      const record = async (delivery: WaiverDelivery, providerMessageId?: string) => {
        await recordWaiverDelivery(tx, {
          shopId,
          waiverRecordId: opened.recordId,
          channel: "email",
          delivery: { status: recordedDeliveryStatus(delivery), providerMessageId },
        });
        return {
          ok: true as const,
          bookingId,
          diverName: ctx.person.fullName,
          token: null,
          delivery,
        };
      };
      // A rehearsal sends nothing (ADR 20261012-rehearsal-departures): the
      // member signs at the counter, as a seat with no address does.
      if (ctx.trip.isRehearsal) {
        return {
          ok: true,
          bookingId,
          diverName: ctx.person.fullName,
          token: null,
          delivery: "thread_only",
        };
      }
      const origin = publicAppUrl();
      if (!origin) return record("no_app_origin");
      const email = ctx.person.email;
      if (!email) return record("no_email");
      const door = await mintCapability(tx, {
        purpose: "party_waiver_link",
        shopId,
        subjectId: opened.recordId,
      });
      if (!door.expiresAt) throw new Error("party_waiver_link minted without an expiry");
      const mailed = await sendAndRecordNotification(
        tx,
        {
          kind: "waiver_request",
          waiverRecordId: opened.recordId,
          bookingId,
          shopId,
          to: email,
          locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
          diverName: ctx.person.fullName,
          shopName: ctx.shop.name,
          tripTitle: ctx.trip.title,
          completionUrl: new URL(`/waivers/${door.token}`, `${origin}/`).toString(),
          expiresAt: door.expiresAt,
          timezone: ctx.shop.timezone,
        },
        { signal: notificationProviderSignal() },
      );
      return record(
        emailDelivery(mailed),
        mailed.status === "sent" ? mailed.providerMessageId : undefined,
      );
    },
  );
  return fenced ?? { ok: false, bookingId, diverName: null, reason: "error" };
}

/**
 * The join-send's "is one owed?" rule, shared by the two ways a joining diver
 * is asked to sign: a waiver link on its own (`issueWaiverOnJoin`) or the
 * thread's Sign step inside the booking confirmation (`openJoinSignStep`).
 */
async function joinWaiverOwed(db: DbExecutor, shopId: string, bookingId: string): Promise<boolean> {
  const readiness = await getBookingReadiness(db, shopId, bookingId);
  // A lapsed release is owed a link exactly as an unsent one is: nothing on
  // file stands, and no link is out.
  const needsWaiver = readiness?.blockers.some(
    (blocker) =>
      blocker.code === "waiver_not_sent" ||
      blocker.code === "waiver_lapsed" ||
      blocker.code === "waiver_runs_out",
  );
  if (!needsWaiver) return false;
  // A held seat is owed nothing yet: its link would open on a record that may
  // be somebody else's, so `issueWaiverRequest` refuses it. Nothing to report
  // as a failure; confirming the seat sends it (issue #2125).
  const [seat] = await db
    .select({ identityUnconfirmedAt: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return !seat?.identityUnconfirmedAt;
}

/**
 * The seat's release, opened for the booking confirmation to carry as the
 * thread's Sign step (issue #2743). It names the record and the seat it was
 * opened on, and no link: the confirmation builds the Sign step from the
 * readiness link it already carries (`readinessWaiverLinkPath`), so the diver
 * holds one credential for the trip, paperwork included.
 */
export type JoinSignStep = {
  waiverRecordId: string;
  personId: string;
  tripId: string;
};

/**
 * **One booking, one email, one link** (UX review 2026-10-11, item 7; issue
 * #2743). The booker's release, opened by the same rule as
 * `issueWaiverOnJoin` and sent with nothing: the booking confirmation carries
 * it as its first step, on the confirmation's own readiness link, and
 * `settleJoinWaiverDelivery` then records how it went. Null when no waiver is
 * owed (a signature still covers the trip, the trip asks for none, the seat is
 * held) or there is no origin to build a link on; the caller then falls back
 * to `issueWaiverOnJoin`, which says why on the record.
 */
export async function openJoinSignStep(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  now: Date = nowDate(),
): Promise<JoinSignStep | null> {
  if (!publicAppUrl()) return null;
  const [observed] = await db
    .select({ personId: bookings.personId, tripId: bookings.tripId, email: people.email })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), seatNotCancelled))
    .limit(1);
  if (!observed) return null;
  const open = async (tx: DbExecutor) => {
    if (!(await joinWaiverOwed(tx, shopId, bookingId))) return null;
    return openSignStep(tx, { shopId, bookingId, ...observed, now });
  };
  if (isTransactionExecutor(db)) return open(db);
  return withErasureCoordinatedBookingSend(
    db,
    {
      shopId,
      bookingId,
      expectedPersonId: observed.personId,
      expectedTripId: observed.tripId,
      expectedEmail: observed.email,
    },
    open,
  );
}

/** Open the seat's release in its thread, for the holder and departure observed. */
async function openSignStep(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; personId: string; tripId: string; now?: Date },
): Promise<JoinSignStep | null> {
  const outcome = await openWaiverInThread(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    expectedPersonId: input.personId,
    expectedTripId: input.tripId,
    now: input.now,
  });
  if (!outcome.ok) return null;
  return { waiverRecordId: outcome.recordId, personId: input.personId, tripId: input.tripId };
}

/**
 * After the confirmation that carried `step` was attempted: when it went out,
 * the Sign step went with it, and the record says it was emailed; when it did
 * not, the waiver goes on its own as a waiver link, on the same record (ADR
 * 20260820-waiver-links-are-reused-not-reissued) rather than a second one.
 * Either way the diver is never left holding nothing. Returns that fallback's
 * result, so a staff door can say whether the link reached anyone; null when
 * the confirmation carried it.
 */
export async function settleJoinWaiverDelivery(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    step: JoinSignStep;
    confirmationSent: boolean;
    /**
     * The provider's id for the confirmation that carried the link. Stored on
     * the waiver's delivery so a bounce on the confirmation flips the waiver
     * to bounced too (issue #2473), which `applyProviderEmailEvent` does for
     * every delivery row sharing the id.
     */
    confirmationProviderMessageId?: string;
    now?: Date;
  },
): Promise<IssueAndDeliverWaiverResult | null> {
  if (!input.confirmationSent) {
    return issueAndDeliverWaiver(db, input.shopId, input.bookingId, {
      now: input.now,
      expectedPersonId: input.step.personId,
      expectedTripId: input.step.tripId,
    });
  }
  const recordDelivery = async (tx: DbExecutor) => {
    const [record] = await tx
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.id, input.step.waiverRecordId),
          eq(waiverRecords.shopId, input.shopId),
          eq(waiverRecords.bookingId, input.bookingId),
          eq(waiverRecords.personId, input.step.personId),
        ),
      )
      .limit(1);
    if (!record) return;
    await recordWaiverDelivery(tx, {
      shopId: input.shopId,
      waiverRecordId: input.step.waiverRecordId,
      channel: "email",
      delivery: { status: "sent", providerMessageId: input.confirmationProviderMessageId },
      now: input.now,
    });
  };
  await withErasureCoordinatedBookingSend(
    db,
    {
      shopId: input.shopId,
      bookingId: input.bookingId,
      expectedPersonId: input.step.personId,
      expectedTripId: input.step.tripId,
    },
    recordDelivery,
  );
  return null;
}

/**
 * The Sign step a re-sent confirmation carries (issue #2473): the seat's live
 * release, kept by `openWaiverInThread` rather than replaced, while a waiver
 * is still owed or out. The mail builds it on its own readiness link (issue
 * #2743), so a waiver link a staffer already sent keeps working beside it.
 * Null when none is owed (signed, or the trip asks for none), the seat is
 * held, or there is no origin to build a link on; the resend then goes out as
 * before.
 */
async function signStepForResend(
  db: AppDb,
  shopId: string,
  bookingId: string,
): Promise<JoinSignStep | null> {
  if (!publicAppUrl()) return null;
  const readiness = await getBookingReadiness(db, shopId, bookingId);
  const owed = readiness?.blockers.some(
    (blocker) =>
      blocker.code === "waiver_not_sent" ||
      blocker.code === "waiver_lapsed" ||
      blocker.code === "waiver_runs_out" ||
      blocker.code === "waiver_pending",
  );
  if (!owed) return null;
  const [seat] = await db
    .select({
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      personId: bookings.personId,
      tripId: bookings.tripId,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!seat || seat.identityUnconfirmedAt) return null;
  return openSignStep(db, { shopId, bookingId, personId: seat.personId, tripId: seat.tripId });
}

/**
 * **Re-send a booking's confirmation with its waiver step** (issue #2473):
 * staff's "resend" used to drop the waiver. The seat's live release rides in
 * the mail as its first step, on the mail's own readiness link (issue #2743),
 * and once the mail has left, the waiver's delivery is recorded against the
 * confirmation's message id so a bounce reaches both. Returns what
 * `retryBookingConfirmation` returns.
 */
export async function resendConfirmationWithWaiver(
  db: AppDb,
  shopId: string,
  bookingId: string,
  provider?: NotificationProvider,
) {
  const step = await signStepForResend(db, shopId, bookingId).catch((error: unknown) => {
    log("booking.resend_waiver_link_failed", "error", {
      bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return null;
  });
  const delivery = await retryBookingConfirmation(
    db,
    shopId,
    bookingId,
    provider,
    step ?? undefined,
  );
  if (step && delivery?.status === "sent" && delivery.carriedSignStep) {
    await settleJoinWaiverDelivery(db, {
      shopId,
      bookingId,
      step,
      confirmationSent: true,
      confirmationProviderMessageId: delivery.providerMessageId,
    });
  } else if (step && delivery?.status === "sent") {
    // The mail went without the Sign step (the seat moved under it): the
    // release goes on its own rather than being recorded as emailed.
    await settleJoinWaiverDelivery(db, { shopId, bookingId, step, confirmationSent: false });
  }
  return delivery;
}

/**
 * What a diver's own rescue attempt from a dead waiver link amounted to. A code,
 * never a sentence — the page picks the words (docs ADR
 * 20260731-domain-layer-copy-leaks).
 */
export type WaiverLinkRescue =
  | "sent"
  | "no_email"
  | "already_signed"
  | "current_link_live"
  | "unavailable"
  | "failed";

/**
 * A diver's self-serve rescue for a waiver link that aged out: issue a fresh
 * one and mail it to the address already on their booking or person record.
 *
 * The security shape matters more than the mechanics. A waiver URL *is* its
 * capability, so a stale one that leaked (a forwarded email, a shared screen)
 * must never be tradeable for fresh access. Two rules keep that true:
 * the fresh token goes only to the address on file — never to the caller, and
 * never displayed or confirmed back on the page — and the return value is a
 * bare outcome code carrying no address, no token, and no booking detail. What
 * a bearer of a dead link can do here is *trigger a delivery to its owner*,
 * which is exactly the affordance staff already had and no more.
 *
 * Repeat taps are safe by construction, and by one explicit refusal.
 * `hasLivePersonWaiverRequest` is the guard: when the person already has a
 * signable link, this reports `current_link_live` and issues nothing.
 *
 * That guard used to be load-bearing for a second reason that no longer holds
 * — issuing superseded every pending record, so a rescue fired against a live
 * link was a remote "wipe this diver's half-filled waiver" button. Reuse ended
 * that (ADR 20260820-waiver-links-are-reused-not-reissued): a live link is now
 * handed back rather than replaced. The refusal stays on the narrower argument
 * it always also had, which is enough on its own: whoever holds a *dead* URL
 * should not be able to drive a delivery on the live one, however harmless the
 * issuing side has become. Otherwise `staleWaiverRecordForToken`
 * keeps resolving the original token after a send, so a second tap on a link
 * whose replacement has since aged out replaces it again rather than failing.
 * A cancelled booking or a sailed trip is refused by the same issuing
 * transaction the staff path uses, and a booking already covered by a signature
 * reports `already_signed` rather than mailing a pointless link.
 *
 * A seat's waiver link is dead by decision (issue #2743): its rescue sends the
 * holder their thread link, to the contact on file, unless the seat already
 * holds a delivered, live one (`hasLiveDeliveredReadinessLink`, the readiness
 * rescue's own guard).
 */
export async function emailFreshWaiverLink(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<WaiverLinkRescue> {
  const stale = await staleWaiverRecordForToken(db, token, now);
  if (!stale) return "unavailable";
  if (stale.bookingId) {
    // A seat's waiver link opens nothing any more (issue #2743): what goes out
    // is the holder's own thread link (`issueAndDeliverWaiver`). The seat and
    // its departure are checked first, so "your link still works" is never
    // said about a seat or a trip that is gone (issue #850); a dead URL then
    // never drives a delivery on a thread link already in the holder's mail.
    if (!(await seatStillSails(db, stale.shopId, stale.bookingId))) return "unavailable";
    if (
      await hasLiveDeliveredReadinessLink(db, {
        shopId: stale.shopId,
        bookingId: stale.bookingId,
        now,
      })
    )
      return "current_link_live";
  } else if (await hasLivePersonWaiverRequest(db, stale.shopId, stale.personId, now)) {
    return "current_link_live";
  }
  // The send is pinned to the person the stale link was issued to, so a seat
  // that changed hands since the read above sends nothing (security review S1).
  const outcome = stale.bookingId
    ? await issueAndDeliverWaiver(db, stale.shopId, stale.bookingId, {
        now,
        expectedPersonId: stale.personId,
      })
    : await issueAndDeliverPersonWaiver(db, stale.shopId, stale.personId, { now });
  if (!outcome.ok) return outcome.reason === "already_completed" ? "already_signed" : "unavailable";
  if (outcome.delivery === "sent") return "sent";
  if (outcome.delivery === "no_email") return "no_email";
  // Issued, but nothing left the building — an unconfigured provider, a
  // rejected recipient, a provider error. Never claim mail is on its way.
  return "failed";
}

/** The seat is held and its departure still scheduled. */
async function seatStillSails(db: DbExecutor, shopId: string, bookingId: string) {
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        seatNotCancelled,
        liveTrip(),
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  return Boolean(seat);
}

export type WaiverBatchFallbackLink = {
  name: string;
  /** Null for a seat: nothing to hand over, only the reason (`deliverThreadLink`). */
  token: string | null;
  /** The seat, when `token` is null, so its row can offer a text instead. */
  bookingId?: string;
  /** Set when the link is not the release's own (`IssueAndDeliverWaiverResult.path`). */
  path?: string;
  reason: WaiverDelivery;
};

/**
 * What a batch of waiver sends did, in the shape the surfaces already render:
 * who got theirs, whose link the staffer must hand over and why, who already
 * had a signed one, and who errored.
 */
export type WaiverBatchOutcome = {
  channel: WaiverSendChannel;
  sent: string[];
  links: WaiverBatchFallbackLink[];
  alreadyDone: string[];
  errors: string[];
};

/**
 * Issue and deliver a waiver to each booking (and optionally one person with
 * no booking), on one channel. The loop `sendWaiversAction` used to carry,
 * lifted here so a held send (ADR 20260906-before-you-ask, decision 2) and an
 * immediate one run the very same code.
 */
export async function deliverWaiverBatch(
  db: AppDb,
  shopId: string,
  input: { bookingIds: string[]; personId?: string; channel: WaiverSendChannel },
): Promise<WaiverBatchOutcome> {
  const outcome: WaiverBatchOutcome = {
    channel: input.channel,
    sent: [],
    links: [],
    alreadyDone: [],
    errors: [],
  };
  const targets: Array<
    { kind: "booking"; bookingId: string } | { kind: "person"; personId: string }
  > = [...new Set(input.bookingIds)].map((bookingId) => ({ kind: "booking", bookingId }));
  if (input.personId) targets.push({ kind: "person", personId: input.personId });
  for (const target of targets) {
    const result =
      target.kind === "person"
        ? await issueAndDeliverPersonWaiver(db, shopId, target.personId, {
            channel: input.channel,
          })
        : await issueAndDeliverWaiver(db, shopId, target.bookingId, { channel: input.channel });
    if (!result.ok) {
      if (result.reason === "already_completed") {
        outcome.alreadyDone.push(result.diverName ?? "");
      } else {
        outcome.errors.push(result.diverName ?? "");
      }
      continue;
    }
    if (result.delivery === "sent") {
      outcome.sent.push(result.diverName);
    } else {
      outcome.links.push({
        name: result.diverName,
        token: result.token,
        ...(result.token === null && result.bookingId ? { bookingId: result.bookingId } : {}),
        ...(result.path ? { path: result.path } : {}),
        reason: result.delivery,
      });
    }
  }
  return outcome;
}

/**
 * What sending the releases a held seat was owed came to, once the desk knows
 * who it is (confirm, or split with every seat it moved). A code the notice
 * picks words for: `sent` when every owed release went out, `ready` when one
 * has a link and nowhere it was sent (the row hands it over on this device or
 * on paper), `failed` when one could not be issued, `not_needed` when no seat
 * owed one. The worst outcome speaks for the lot.
 */
export type IdentityReleaseOutcome = "sent" | "ready" | "failed" | "not_needed";

export async function sendReleasesOnceIdentityKnown(
  db: AppDb,
  shopId: string,
  bookingIds: readonly string[],
): Promise<IdentityReleaseOutcome> {
  let outcome: IdentityReleaseOutcome = "not_needed";
  const rank: Record<IdentityReleaseOutcome, number> = {
    not_needed: 0,
    sent: 1,
    ready: 2,
    failed: 3,
  };
  // One at a time: each send reads and writes the seat's own readiness.
  for (const bookingId of bookingIds) {
    const result = await issueWaiverOnJoin(db, shopId, bookingId).catch(() => "failed" as const);
    const seat: IdentityReleaseOutcome =
      result === null
        ? "not_needed"
        : result === "failed"
          ? "failed"
          : !result.ok
            ? result.reason === "already_completed"
              ? "not_needed"
              : "failed"
            : result.delivery === "sent"
              ? "sent"
              : "ready";
    if (rank[seat] > rank[outcome]) outcome = seat;
  }
  return outcome;
}
