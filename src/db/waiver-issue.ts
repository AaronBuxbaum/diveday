import { and, eq, isNull } from "drizzle-orm";
import {
  courseFormsLinkPath,
  readinessWaiverLinkPath,
  seatAddressIsLeadTyped,
} from "@/lib/booking-capabilities";
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
import { issueBookingCapability } from "./booking-capabilities";
import { mintCapability } from "./capabilities";
import type { AppDb, DbExecutor } from "./client";
import { getCourseFormsForBooking } from "./course-forms";
import {
  withErasureCoordinatedBookingSend,
  withErasureCoordinatedPersonSend,
} from "./erasure-coordinated-send";
import {
  retryBookingConfirmation,
  sendAndRecordNotification,
  sendClaimedSeatConfirmation,
} from "./notifications";
import { recordDiverActivity } from "./operations";
import { isTransactionExecutor } from "./query-helpers";
import { getBookingReadiness } from "./readiness";
import { bookings, capabilities, people, shops, trips, waiverRecords } from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { seatNotCancelled } from "./trips-queries";
import { personContactLeadTyped, seatMinorDeclared } from "./waiver-signing";
import {
  hasLivePersonWaiverRequest,
  openWaiverInThread,
  recordWaiverDelivery,
  staleWaiverRecordForToken,
} from "./waivers";
import { openPersonRelease } from "./waivers-requests";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/**
 * The one place that issues a waiver link *and* delivers it. Both the trip
 * roster and the Today/Blockers one-tap sends call this so a waiver is never
 * issued by a different rule in two places (the transaction lives in
 * `openWaiverInThread` and `openPersonRelease`; this wraps them with delivery and the context a notice
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
  | "thread_only"
  /**
   * A minor's seat whose address the party's lead typed (issue #4003):
   * nothing was sent, because a guardian is something that address cannot
   * prove. A parent signs with them at the counter, or the lead signs it.
   */
  | "guardian_needed"
  /**
   * Copy link on a minor's release with no seat, before the desk said a
   * parent or legal guardian is at the counter to co-sign (issue #4019):
   * nothing was minted. Asked again with `guardianPresent`.
   */
  | "guardian_check";

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
      /**
       * A seat's record holds a number a text can reach, so a staffer may try
       * one where email did not land (issue #3984). False for a minor whose
       * address the lead typed: a text would carry nothing either.
       */
      textable?: boolean;
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
      /**
       * The counter link Copy link asked for (`waiver_link`: half an hour, the
       * first phone to open it), and only that: a release with no seat covers
       * every seat the diver holds once signed, so the week-long release link
       * an email or a text carries never comes back to staff, sent or not
       * (issue #3983).
       */
      token: string | null;
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
   * The instant to issue against, threaded down to the release it opens.
   *
   * It matters now that a live link is reused rather than replaced: whether the
   * diver already holds a signable link is a question about a moment, and a
   * caller that has one (`emailFreshWaiverLink` decides "is this URL stale?"
   * against its own `now`) must not have the issuing half silently answer it
   * against a different one. Defaults to the clock, which is every other caller.
   */
  now?: Date;
  /**
   * The staffer asking. Copy link on a release with no seat refuses without
   * one: the URL can sign as the diver, so who took it goes on their trail.
   */
  actorPersonId?: string | null;
  /**
   * Copy link on a release with no seat: the desk confirmed a parent or legal
   * guardian is at the counter to co-sign a minor's release (issue #4019).
   */
  guardianPresent?: boolean;
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
 *
 * **A minor's seat whose address its party's lead typed gets nothing**
 * (issue #4003, `seatAddressIsLeadTyped`): a guardian is something that
 * address cannot prove, so the lead signs it on their own link or the desk
 * does. An adult party member gets the thread link like any holder.
 */
async function deliverThreadLink(
  tx: DbExecutor,
  input: {
    ctx: {
      person: typeof people.$inferSelect;
      trip: typeof trips.$inferSelect;
      shop: typeof shops.$inferSelect;
      seat: {
        contactTypedByLeadAt: Date | null;
        claimedAt: Date | null;
      };
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
  if (seatAddressIsLeadTyped(ctx.seat)) return "guardian_needed";
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
        .select({
          person: people,
          trip: trips,
          shop: shops,
          seat: {
            contactTypedByLeadAt: bookings.contactTypedByLeadAt,
            claimedAt: bookings.claimedAt,
          },
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
        textable: delivered !== "guardian_needed" && smsRecipient(ctx.person.phone) !== null,
      };
    },
  );
  return fenced ?? { ok: false, bookingId, diverName: null, reason: "error" };
}

/**
 * The same, for a diver directly, with no booking or schedule required: one
 * release, kept open across sends, so two sends from their record hand over
 * the same release and its draft rather than two.
 *
 * Which link opens it depends on who it is for (issue #3983). Signed, a
 * release with no seat covers every seat the diver holds, so:
 *
 * - **Copy link** (`link`) mints a counter link (`waiver_link`): half an hour,
 *   and only on the first phone that opens it. That is the URL staff get.
 * - **Email and text** mint a release link (`release_link`): a week, to the
 *   contact on file only. Its token never comes back, sent or not; a staffer
 *   who needs a URL to hand over asks for Copy link.
 *
 * A send never closes a link already out (ux-over-hardening): a resend adds a
 * link beside the one the diver may be half-way through, and a send that
 * reaches nobody withdraws only the link it minted. Whichever link signs, the
 * others then open nothing.
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
      const outcome = await openPersonRelease(tx, { shopId, personId, now: options.now });
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
      const channel = options.channel ?? "email";
      if (channel === "link" && !options.actorPersonId) {
        return {
          ok: false as const,
          bookingId: null,
          diverName: ctx.person.fullName,
          reason: "error" as const,
        };
      }
      // A minor's release, by the date of birth on file or "Under 18" on any
      // live seat: signed, it covers every seat they hold (issue #4019).
      const minor = guardianSignatureRequired(
        ctx.person.dateOfBirth,
        signingDate(options.now ?? nowDate(), ctx.shop.timezone),
        await seatMinorDeclared(
          tx,
          { shopId, personId, bookingId: null },
          options.now ?? nowDate(),
        ),
      );
      // Copy link asks the desk what a seat's counter QR asks (issue #3986)
      // before anything is minted: nobody else at the counter can say whether
      // the person typing a guardian's name is one.
      if (channel === "link" && minor && options.guardianPresent !== true) {
        return {
          ok: true as const,
          bookingId: null,
          diverName: ctx.person.fullName,
          token: null,
          delivery: "guardian_check" as const,
        };
      }
      // A minor whose contact the party's lead may have typed gets no mailed
      // link: that address cannot prove a guardian (issues #4003, #4019).
      if (channel !== "link" && minor && (await personContactLeadTyped(tx, shopId, personId))) {
        return {
          ok: true as const,
          bookingId: null,
          diverName: ctx.person.fullName,
          token: null,
          delivery: "guardian_needed" as const,
        };
      }
      const origin = publicAppUrl();
      const mint = (purpose: "waiver_link" | "release_link") =>
        mintCapability(tx, { purpose, shopId, subjectId: outcome.recordId, now: options.now });
      const urlFor = (token: string) => new URL(`/waivers/${token}`, `${origin}/`).toString();
      let token: string | null = null;
      let delivery: WaiverDelivery;
      let providerMessageId: string | undefined;
      let minted: { id: string } | null = null;
      if (channel === "link") {
        // The URL staff asked for is a counter link, whether or not this
        // deployment knows its own origin, and who took it is on the diver's
        // trail in the same transaction: no trail line, no link.
        const link = await mint("waiver_link");
        const recorded = await recordDiverActivity(tx, {
          shopId,
          personId,
          actorPersonId: options.actorPersonId as string,
          code: "waiver_link_copied",
          waiverRecordId: outcome.recordId,
        });
        if (!recorded) throw new CopyLinkNotRecorded();
        if (minor) {
          // The desk's word, naming this very link: signing asks for it.
          const confirmed = await recordDiverActivity(tx, {
            shopId,
            personId,
            actorPersonId: options.actorPersonId as string,
            code: "waiver_counter_guardian_confirmed",
            waiverRecordId: outcome.recordId,
            linkId: link.id,
          });
          if (!confirmed) throw new CopyLinkNotRecorded();
        }
        token = link.token;
        delivery = origin ? "link_only" : "no_app_origin";
      } else if (!origin) {
        delivery = "no_app_origin";
      } else if (channel === "sms") {
        if (!smsRecipient(ctx.person.phone)) {
          delivery = "no_phone";
        } else {
          const link = await mint("release_link");
          minted = link;
          const result = await textWaiverLink(tx, {
            shopId,
            phone: ctx.person.phone,
            shopName: ctx.shop.name,
            locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
            completionUrl: urlFor(link.token),
            providers: options.textProviders,
            signal: notificationProviderSignal(),
          });
          delivery = result.delivery;
          providerMessageId = result.providerMessageId;
        }
      } else if (!ctx.person.email) {
        delivery = "no_email";
      } else {
        const link = await mint("release_link");
        minted = link;
        if (!link.expiresAt) throw new Error("release_link minted without an expiry");
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
            completionUrl: urlFor(link.token),
            expiresAt: link.expiresAt,
            timezone: ctx.shop.timezone,
          },
          { provider: options.provider, signal: notificationProviderSignal() },
        );
        providerMessageId = result.status === "sent" ? result.providerMessageId : undefined;
        delivery = emailDelivery(result);
      }
      // The link this send minted reached nobody, so it is withdrawn: nobody
      // holds it, and a live one would turn the diver's own rescue away
      // (`current_link_live`). Every link already out is left as it was.
      if (minted && delivery !== "sent") {
        await tx
          .update(capabilities)
          .set({ revokedAt: options.now ?? nowDate() })
          .where(eq(capabilities.id, minted.id));
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
        token,
        delivery,
      };
    },
  );
  return (
    fenced ?? { ok: false, bookingId: null, diverName: observed.person.fullName, reason: "error" }
  );
}

class CopyLinkNotRecorded extends Error {}

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
 * A minor's seat whose address the lead typed is sent nothing
 * (`deliverThreadLink`, issue #4003).
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
  // be somebody else’s, so `openWaiverInThread` refuses it. Nothing to report
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
 * **A claimed seat's one email** (issue #2743): the claimant's booking
 * confirmation, carrying the seat's release as its Sign step on the mail's own
 * readiness link whenever one is owed or still out. When the mail cannot carry
 * the step, the release goes on its own as the thread link
 * (`settleJoinWaiverDelivery`); when none is owed, nothing goes.
 */
export async function confirmClaimedSeat(
  db: AppDb,
  shopId: string,
  bookingId: string,
): Promise<void> {
  // The confirmation goes whatever the Sign step does: it is the claimant's
  // only link (reviews of #2743).
  const step = await signStepForResend(db, shopId, bookingId).catch((error: unknown) => {
    log("seat_claim.sign_step_failed", "error", {
      bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return null;
  });
  let delivery: Awaited<ReturnType<typeof sendClaimedSeatConfirmation>> = null;
  try {
    delivery = await sendClaimedSeatConfirmation(db, shopId, bookingId, { signStep: step });
  } finally {
    if (!step) {
      await issueWaiverOnJoin(db, shopId, bookingId);
    } else {
      const sent = delivery?.status === "sent" && delivery.carriedSignStep ? delivery : null;
      await settleJoinWaiverDelivery(db, {
        shopId,
        bookingId,
        step,
        confirmationSent: sent !== null,
        confirmationProviderMessageId: sent?.providerMessageId,
      });
    }
  }
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
 * A diver's self-serve rescue for a release link that no longer opens its
 * release (expired, or closed by a contact change): issue a fresh
 * one and mail it to the address on the person's record.
 *
 * The security shape matters more than the mechanics. A waiver URL *is* its
 * capability, so a stale one that leaked (a forwarded email, a shared screen)
 * must never be tradeable for fresh access. Two rules keep that true: the
 * fresh link goes only to the address on file, never to the caller, and is
 * never displayed or confirmed back on the page; and the return value is a
 * bare outcome code carrying no address, no token and no record detail. What a
 * bearer of a dead link can do here is *trigger a delivery to its owner*,
 * which is exactly the affordance staff already had and no more.
 *
 * `hasLivePersonWaiverRequest` is the guard: when the person already holds a
 * live release link (a counter link does not count), this reports
 * `current_link_live` and sends nothing, since the diver already has a link
 * that works. `staleWaiverRecordForToken` keeps
 * resolving the original token after a send, so a second tap on a link whose
 * replacement has since aged out replaces it again rather than failing.
 *
 * Only a release link with no seat reaches here (issue #3983). A counter
 * link's way on is a fresh code from the staff.
 */
export async function emailFreshWaiverLink(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<WaiverLinkRescue> {
  const stale = await staleWaiverRecordForToken(db, token, now);
  if (!stale) return "unavailable";
  if (await hasLivePersonWaiverRequest(db, stale.shopId, stale.personId, now)) {
    return "current_link_live";
  }
  const outcome = await issueAndDeliverPersonWaiver(db, stale.shopId, stale.personId, { now });
  if (!outcome.ok) return outcome.reason === "already_completed" ? "already_signed" : "unavailable";
  if (outcome.delivery === "sent") return "sent";
  if (outcome.delivery === "no_email") return "no_email";
  // A minor whose contact a party's lead typed is sent nothing (issue #4019).
  if (outcome.delivery === "guardian_needed") return "unavailable";
  // Issued, but nothing left the building — an unconfigured provider, a
  // rejected recipient, a provider error. Never claim mail is on its way.
  return "failed";
}

export type WaiverBatchFallbackLink = {
  name: string;
  /** Null for a seat: nothing to hand over, only the reason (`deliverThreadLink`). */
  token: string | null;
  /** The seat, when `token` is null, so its row can offer a text instead. */
  bookingId?: string;
  /** The seat's record holds a number a text can reach (`IssueAndDeliverWaiverResult`). */
  textable?: boolean;
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
  input: {
    bookingIds: string[];
    personId?: string;
    channel: WaiverSendChannel;
    /** The staffer sending; Copy link on a release with no seat needs one. */
    actorPersonId?: string | null;
    /** Copy link: the desk confirmed a parent or guardian is at the counter (issue #4019). */
    guardianPresent?: boolean;
  },
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
            actorPersonId: input.actorPersonId,
            guardianPresent: input.guardianPresent,
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
        ...(result.token === null && result.bookingId
          ? {
              bookingId: result.bookingId,
              textable: "textable" in result && result.textable === true,
            }
          : {}),
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
