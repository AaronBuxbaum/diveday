import { and, eq, isNull, ne } from "drizzle-orm";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { type CourtesyProviders, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import { smsProviderFromEnvironment, smsRecipient } from "@/lib/notifications/sms";
import type { AppDb } from "./client";
import { sendAndRecordNotification, sendNotification } from "./notifications";
import { getBookingReadiness } from "./readiness";
import { bookings, people, shops, trips } from "./schema";
import {
  hasLivePersonWaiverRequest,
  hasLiveWaiverRequest,
  issueWaiverRequest,
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
export type WaiverSendChannel = "email" | "text" | "link";

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
  | "link_only";

/**
 * The shop's own text senders, resolved once per send.
 *
 * Injectable so a test can drive both halves without AWS or Meta credentials,
 * and so the one rule that prefers a shop's own WhatsApp over platform SMS
 * (`sendCourtesyMessage`) stays in the one place that owns it.
 */
export async function waiverTextProviders(db: AppDb, shopId: string): Promise<CourtesyProviders> {
  const senders = await whatsAppProvidersForShops(db, [shopId]);
  return { sms: smsProviderFromEnvironment(), whatsapp: senders.get(shopId) ?? null };
}

/**
 * The text a diver reads on their phone, in their own language.
 *
 * Composed here rather than returned as a code because nothing downstream picks
 * words for a sent text — the same terminal-renderer exception `reminderSmsBody`
 * takes (docs ADR 20260731-notification-locale).
 */
function waiverTextBody(
  t: DiverTranslator,
  input: { shopName: string; tripTitle?: string; completionUrl: string },
): string {
  return input.tripTitle
    ? t("notifications.sms.waiverForTrip", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        url: input.completionUrl,
      })
    : t("notifications.sms.waiver", { shopName: input.shopName, url: input.completionUrl });
}

/**
 * Text one diver their waiver link over the shop's own WhatsApp when it has
 * connected one, and platform SMS otherwise — one message either way, never
 * both (`src/lib/notifications/courtesy.ts`).
 */
async function textWaiverLink(
  db: AppDb,
  input: {
    shopId: string;
    phone: string | null;
    shopName: string;
    tripTitle?: string;
    locale: string;
    completionUrl: string;
    providers?: CourtesyProviders;
  },
): Promise<{ delivery: WaiverDelivery; providerMessageId?: string }> {
  const to = smsRecipient(input.phone);
  if (!to) return { delivery: "no_phone" };
  const providers = input.providers ?? (await waiverTextProviders(db, input.shopId));
  const { delivery } = await sendCourtesyMessage(
    {
      to,
      shopName: input.shopName,
      body: waiverTextBody(diverTranslator(input.locale), {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        completionUrl: input.completionUrl,
      }),
    },
    providers,
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
      /** The bearer link (token path) to hand over when delivery was not `sent`. */
      token: string;
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
  | (Omit<Extract<IssueAndDeliverWaiverResult, { ok: true }>, "bookingId"> & { bookingId: null })
  | (Omit<Extract<IssueAndDeliverWaiverResult, { ok: false }>, "bookingId"> & { bookingId: null });

/** Which channel to hand the link over on, plus test seams for the text one. */
export type WaiverDeliveryOptions = {
  /** Defaults to `email`, which is every caller that predates the channel. */
  channel?: WaiverSendChannel;
  /** Injected text senders, so a test never needs AWS or Meta credentials. */
  textProviders?: CourtesyProviders;
};

/**
 * Issue a fresh waiver link for a booking and hand it over on the asked-for
 * channel. Delivery is best-effort: a missing address or number, missing app
 * origin, or a failed/disabled provider all resolve to a non-`sent` delivery so
 * the caller surfaces the private link instead of pretending anything went out.
 */
export async function issueAndDeliverWaiver(
  db: AppDb,
  shopId: string,
  bookingId: string,
  options: WaiverDeliveryOptions = {},
): Promise<IssueAndDeliverWaiverResult> {
  const [ctx] = await db
    .select({ person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);

  const outcome = await issueWaiverRequest(db, { shopId, bookingId });
  if (!outcome.ok) {
    return {
      ok: false,
      bookingId,
      diverName: ctx?.person.fullName ?? null,
      reason: outcome.reason === "already_completed" ? "already_completed" : "error",
    };
  }

  // `issueWaiverRequest` already validated the booking, so `ctx` is present in
  // every real path; guard only so a race that cancels mid-issue degrades to the
  // link rather than throwing.
  const diverName = ctx?.person.fullName ?? "";
  const email = ctx?.person.email ?? null;
  const origin = publicAppUrl();
  const channel = options.channel ?? "email";
  const completionUrl = origin
    ? new URL(`/waivers/${outcome.token}`, `${origin}/`).toString()
    : null;

  // Two different "we could not send this" states that used to collapse into
  // one. `unconfigured` means no provider; `no_app_origin` means the
  // provider may be fine but `APP_HOST` is unset, so there is no origin to
  // build the diver's link on and nothing is attempted. Telling a shop "no
  // email provider configured" when the actual gap is a missing APP_HOST sends
  // them to look at the wrong setting.
  let delivery: WaiverDelivery = "no_app_origin";
  let providerMessageId: string | undefined;
  if (channel === "link") {
    delivery = completionUrl ? "link_only" : "no_app_origin";
  } else if (channel === "text") {
    if (!completionUrl) {
      delivery = "no_app_origin";
    } else if (!ctx) {
      // `issueWaiverRequest` already validated the booking, so this is only
      // reachable if the row went away mid-issue. Reported as `failed` rather
      // than `no_app_origin`, which is the same distinction the person-scoped
      // path makes: a vanished booking is a data problem, and naming it after
      // a missing APP_HOST sends the shop to the wrong setting.
      delivery = "failed";
    } else {
      const result = await textWaiverLink(db, {
        shopId,
        phone: ctx.person.phone,
        shopName: ctx.shop.name,
        tripTitle: ctx.trip.title,
        locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
        completionUrl,
        providers: options.textProviders,
      });
      delivery = result.delivery;
      providerMessageId = result.providerMessageId;
    }
  } else if (!email) {
    delivery = "no_email";
  } else if (completionUrl && ctx) {
    const result = await sendAndRecordNotification(db, {
      kind: "waiver_request",
      waiverRecordId: outcome.recordId,
      bookingId,
      shopId,
      to: email,
      locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
      diverName: ctx.person.fullName,
      shopName: ctx.shop.name,
      tripTitle: ctx.trip.title,
      completionUrl,
      expiresAt: outcome.expiresAt,
      timezone: ctx.shop.timezone,
    });
    providerMessageId = result.status === "sent" ? result.providerMessageId : undefined;
    delivery =
      result.status === "sent"
        ? "sent"
        : result.status === "not_configured"
          ? "unconfigured"
          : result.errorCode === "invalid_test_recipient"
            ? "test_recipient"
            : "failed";
  }
  await recordWaiverDelivery(db, {
    waiverRecordId: outcome.recordId,
    delivery: { status: recordedDeliveryStatus(delivery), providerMessageId },
  });

  return { ok: true, bookingId, diverName, token: outcome.token, delivery };
}

/** Issue and deliver a waiver directly to a diver, with no booking or schedule required. */
export async function issueAndDeliverPersonWaiver(
  db: AppDb,
  shopId: string,
  personId: string,
  options: WaiverDeliveryOptions = {},
): Promise<PersonWaiverResult> {
  const [ctx] = await db
    .select({ person: people, shop: shops })
    .from(people)
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .limit(1);
  const outcome = await issueWaiverRequest(db, { shopId, personId });
  if (!outcome.ok) {
    return {
      ok: false,
      bookingId: null,
      diverName: ctx?.person.fullName ?? null,
      reason: outcome.reason === "already_completed" ? "already_completed" : "error",
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
  } else if (!ctx) {
    // `issueWaiverRequest` already validated the person, so this is only
    // reachable if the row went away mid-issue. Nothing was attempted, and
    // there is a token to hand over either way.
    delivery = "failed";
  } else if (channel === "link") {
    delivery = "link_only";
  } else if (channel === "text") {
    const result = await textWaiverLink(db, {
      shopId,
      phone: ctx.person.phone,
      shopName: ctx.shop.name,
      locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
      completionUrl,
      providers: options.textProviders,
    });
    delivery = result.delivery;
    providerMessageId = result.providerMessageId;
  } else if (!ctx.person.email) {
    delivery = "no_email";
  } else {
    const result = await sendNotification(db, {
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
    });
    providerMessageId = result.status === "sent" ? result.providerMessageId : undefined;
    delivery =
      result.status === "sent"
        ? "sent"
        : result.status === "not_configured"
          ? "unconfigured"
          : result.errorCode === "invalid_test_recipient"
            ? "test_recipient"
            : "failed";
  }
  await recordWaiverDelivery(db, {
    waiverRecordId: outcome.recordId,
    delivery: { status: recordedDeliveryStatus(delivery), providerMessageId },
  });
  return {
    ok: true,
    bookingId: null,
    diverName: ctx?.person.fullName ?? "",
    token: outcome.token,
    delivery,
  };
}

/**
 * Send a waiver the moment a diver joins a dive — but only when one is actually
 * needed. "Needed" is exactly the readiness engine's `waiver_not_sent` blocker:
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
): Promise<IssueAndDeliverWaiverResult | null> {
  const readiness = await getBookingReadiness(db, shopId, bookingId);
  const needsWaiver = readiness?.blockers.some((blocker) => blocker.code === "waiver_not_sent");
  if (!needsWaiver) return null;
  return issueAndDeliverWaiver(db, shopId, bookingId);
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
 * Repeat taps are safe by construction, and by one explicit refusal. Issuing
 * supersedes *every* non-superseded pending record for the booking, so a rescue
 * fired while a fresher link is still live would kill that live link and take
 * the diver's saved draft with it — a stale URL in the wrong hands would be a
 * remote "wipe this diver's half-filled waiver" button. `hasLiveWaiverRequest`
 * is the guard: when the booking already has a signable link, this reports
 * `current_link_live` and issues nothing. Otherwise `staleWaiverRecordForToken`
 * keeps resolving the original token after a send, so a second tap on a link
 * whose replacement has since aged out replaces it again rather than failing.
 * A cancelled booking or a sailed trip is refused by the same issuing
 * transaction the staff path uses, and a booking already covered by a signature
 * reports `already_signed` rather than mailing a pointless link.
 */
export async function emailFreshWaiverLink(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<WaiverLinkRescue> {
  const stale = await staleWaiverRecordForToken(db, token, now);
  if (!stale) return "unavailable";
  if (stale.bookingId) {
    if (await hasLiveWaiverRequest(db, stale.bookingId, now)) return "current_link_live";
  } else if (await hasLivePersonWaiverRequest(db, stale.shopId, stale.personId, now)) {
    return "current_link_live";
  }
  const outcome = stale.bookingId
    ? await issueAndDeliverWaiver(db, stale.shopId, stale.bookingId)
    : await issueAndDeliverPersonWaiver(db, stale.shopId, stale.personId);
  if (!outcome.ok) return outcome.reason === "already_completed" ? "already_signed" : "unavailable";
  if (outcome.delivery === "sent") return "sent";
  if (outcome.delivery === "no_email") return "no_email";
  // Issued, but nothing left the building — an unconfigured provider, a
  // rejected recipient, a provider error. Never claim mail is on its way.
  return "failed";
}
