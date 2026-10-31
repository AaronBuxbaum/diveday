import {
  failedPhotoDeletionDetailText,
  incidentDraftStartedWhen,
  incidentReportUnfiledSubjectText,
  mediaDeletionKindText,
  openDataSettingsActionText,
  openDateRequestsActionText,
  openInboxActionText,
  openIncidentReportActionText,
  openOrderActionText,
  openOrdersActionText,
  openPaymentSettingsActionText,
  openReviewsActionText,
  openTripActionText,
  paymentDisputeDetailText,
  paymentDisputeSubjectText,
  paymentsRestrictedDetailText,
  paymentsRestrictedSubjectText,
  reviewsPendingSubjectText,
  stuckOperationKindText,
  stuckPaymentOperationDetailText,
  unansweredMessagesSubjectText,
} from "@/i18n/today-labels";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { collapseOwedRefunds, type TodayAction } from "@/lib/today";
import type { TodayRowsContext } from "./today-rows-context";

/**
 * The rows about the shop rather than one departure: the payment rows' invoice controls, the owner's platform chores, reviews awaiting moderation and unanswered messages.
 */
export function pushShopRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { shopSlug, timeZone, locale, t, now } = ctx;
  const {
    opsAlerts,
    reviewsAwaiting,
    unanswered,
    openDateRequests,
    openOrders,
    unfiledIncidentDrafts,
  } = ctx.wave;
  // A payment row only gets the inline "copy link"/"resend invoice" control
  // once we know the booking was actually invoiced through Stripe: a diver
  // who owes at the counter has no invoice to act on, and a shop with no
  // connected Stripe account has nothing to resend either. Both cases keep
  // the row's `href` fallback to the roster instead of a dead button.
  if (actions.some((action) => action.payment)) {
    for (const action of actions) {
      if (!action.payment) continue;
      const order = openOrders.get(action.payment.bookingId);
      action.payment = order
        ? {
            bookingId: action.payment.bookingId,
            orderId: order.id,
            hostedInvoiceUrl: order.hostedInvoiceUrl,
          }
        : undefined;
    }
  }

  // Platform-health chores: stuck Stripe operations and photo deletions that
  // never finished. Forced `urgency: "now"` (there is no departure to derive
  // it from) so they land in today's queue the day they go stale; `dueAt: null`
  // keeps them after every dated row in that band. Each row's `href` points at
  // the panel that owns the work: payments on Orders, deletions in Settings.
  if (opsAlerts) {
    const [stuckOperations, pendingDeletions, owedRefunds, openDisputes, restrictedSince] =
      opsAlerts;

    // Stripe card payments are off for this shop. One row while they stay
    // off: bookings already fall back to paying at the shop, so this is
    // the standing reminder that the owner has something to answer in
    // Stripe, beside the one email they got when it happened.
    if (restrictedSince) {
      actions.push({
        id: "payments-restricted",
        kind: "payments_restricted",
        urgency: "now",
        subject: paymentsRestrictedSubjectText(t),
        context: null,
        detail: paymentsRestrictedDetailText(t, formatShortDate(restrictedSince, locale, timeZone)),
        actionLabel: openPaymentSettingsActionText(t),
        href: `/shop/${shopSlug}/settings#money`,
        dueAt: null,
      });
    }

    // A diver's bank is taking a charge back (ADR
    // 20261009-stripe-reversals-reach-diveday). One row per undecided dispute,
    // from the day Stripe reports it until it is decided: the amount and the
    // day Stripe stops taking evidence are what the owner acts on. The door is
    // the order it was raised against, or the departure a checkout paid for.
    for (const dispute of openDisputes) {
      actions.push({
        id: `payment-dispute:${dispute.id}`,
        kind: "payment_dispute",
        urgency: "now",
        subject: dispute.personName ?? paymentDisputeSubjectText(t),
        context: dispute.tripTitle,
        detail: paymentDisputeDetailText(t, {
          amount: formatMoneyCents(dispute.amountCents, dispute.currency, locale),
          due: dispute.evidenceDueBy
            ? formatShortDate(dispute.evidenceDueBy, locale, timeZone)
            : null,
        }),
        actionLabel: dispute.orderId
          ? openOrderActionText(t)
          : dispute.tripId
            ? openTripActionText(t)
            : openOrdersActionText(t),
        href: dispute.orderId
          ? `/shop/${shopSlug}/orders/${dispute.orderId}`
          : dispute.tripId
            ? `/shop/${shopSlug}/trips/${dispute.tripId}`
            : `/shop/${shopSlug}/orders`,
        // Undated on purpose, like every row here: the deadline is in the
        // sentence, and a dated row would sort against departures it is not
        // about.
        dueAt: null,
      });
    }

    for (const op of stuckOperations) {
      const when = formatShortDate(op.intent.startedAt, locale, timeZone);
      actions.push({
        id: `stuck-payment-op:${op.intent.id}`,
        kind: "stuck_payment_operation",
        urgency: "now",
        subject: op.personName ?? op.tripTitle ?? stuckOperationKindText(t, op.intent.kind),
        context: op.personName && op.tripTitle ? op.tripTitle : null,
        // No Stripe object id here: it belongs on the Orders queue, where the
        // object it names is (principle 4 — never surface the implementation).
        detail: stuckPaymentOperationDetailText(t, op.intent.kind, when),
        // Points at the trip roster when there's one to point at; otherwise
        // Orders, which carries the reconciliation detail (Stripe id, exact
        // timestamp) to act from.
        actionLabel: op.tripId ? openTripActionText(t) : openOrdersActionText(t),
        href: op.tripId ? `/shop/${shopSlug}/trips/${op.tripId}` : `/shop/${shopSlug}/orders`,
        dueAt: null,
      });
    }

    for (const attempt of pendingDeletions) {
      actions.push({
        id: `media-deletion:${attempt.id}`,
        kind: "failed_photo_deletion",
        urgency: "now",
        subject: mediaDeletionKindText(t, attempt.kind),
        context: null,
        // The kind is this row's own subject and the queued-at date is
        // bookkeeping, so the sentence carries only what a staffer cannot see
        // without it: the file outlived the record.
        detail: failedPhotoDeletionDetailText(t),
        // Settings' "Data" group — the retry button for a stuck
        // deletion lives there now, at the group anchor this href lands on.
        actionLabel: openDataSettingsActionText(t),
        href: `/shop/${shopSlug}/settings#data`,
        dueAt: null,
      });
    }

    // Money the shop owes a diver for a departure it cancelled and could not
    // put back on the card. Mirrored here, not owned here: the panel on the
    // Orders index is where these live and where staff act on them, the same
    // arrangement the two queues above use.
    //
    // This is the one platform-health row with a person waiting on the other
    // end of it — every one of these divers has already had an email saying the
    // shop will be in touch.
    //
    // **One row per departure, not per seat.** A shop that pulls a charter owes
    // every paid seat on it, so five rows would repeat one sentence five times
    // (principle 9); `collapseOwedRefunds` keeps the lone case exactly as it
    // was and groups the rest under the boat, naming who is waiting. The
    // departure's Trip surface is the door either way — it is both where the
    // seats are and where each payment gets marked refunded once the cash is
    // back in a hand.
    for (const owed of collapseOwedRefunds(
      owedRefunds.map((row) => ({
        bookingId: row.bookingId,
        diverName: row.diverName,
        tripId: row.tripId,
        tripTitle: row.tripTitle,
        when: formatShortDate(row.tripStartsAt, locale, timeZone),
        amountCents: row.amountCents,
        currency: row.currency,
      })),
      shopSlug,
      locale,
      t,
    )) {
      actions.push(owed);
    }
  }

  // Incident reports started and never filed (safety sheet 2026-10-15, item
  // 3): an injury written up on the boat can sit as a private draft while the
  // insurer's notice window runs, and drafts showed only on the trip page and
  // the Safety tab. One line for all of them, naming who started the oldest and
  // when, and opening that draft. The wave reads them for owners and managers
  // only (`listUnfiledIncidentDrafts`), the two roles that may already read
  // every report; undated, like every row here.
  const oldestDraft = unfiledIncidentDrafts[0];
  if (oldestDraft) {
    actions.push({
      id: "incident-reports:unfiled",
      kind: "incident_report_unfiled",
      urgency: "now",
      subject: incidentReportUnfiledSubjectText(t, {
        count: unfiledIncidentDrafts.length,
        name: oldestDraft.createdByName,
        ...incidentDraftStartedWhen(oldestDraft.createdAt, now, locale, timeZone),
      }),
      context: null,
      // The count, the writer and the day are the row.
      detail: "",
      actionLabel: openIncidentReportActionText(t),
      href: `/shop/${shopSlug}/trips/${oldestDraft.tripId}/incidents/${oldestDraft.id}`,
      dueAt: null,
    });
  }

  // Reviews waiting on moderation. One row for the whole queue (never one per
  // review), `later` urgency and `dueAt: null` because nothing sails or refunds
  // on a review — it informs, it never nags.
  // At a count of exactly 1 the row lands on that review's own anchor rather
  // than the top of the index, since there is a single "the" review to open;
  // at 2 or more there is not, and the destination stays the bare list. The
  // anchor id is the reviews list's own `review-<id>`, the same fragment a
  // refused hide already redirects back to.
  if (reviewsAwaiting.count > 0) {
    const reviewsHref = `/shop/${shopSlug}/reviews`;
    actions.push({
      id: "reviews:pending",
      kind: "reviews_pending",
      urgency: "later",
      subject: reviewsPendingSubjectText(t, reviewsAwaiting.count),
      context: null,
      // The count is the row (see `reviewsPendingSubjectText`).
      detail: "",
      actionLabel: openReviewsActionText(t),
      href: reviewsAwaiting.onlyId
        ? `${reviewsHref}#review-${reviewsAwaiting.onlyId}`
        : reviewsHref,
      dueAt: null,
    });
  }

  // Divers who wrote back and are still waiting (ADR 20260907-two-way-inbox).
  // One row for the whole inbox rather than one per message, `later` urgency
  // and `dueAt: null` — the shape the reviews row above already has, and for
  // the same reason: nothing sails on an unanswered message, and a row per
  // message would be the inbox rendered twice. Nothing at all at zero.
  // Open date requests count into the same row: one unanswered
  // count on Today, while the requests keep their own page. It opens the inbox
  // when a message is waiting (Requests is a tab beside it), else Requests.
  if (unanswered + openDateRequests > 0) {
    actions.push({
      id: "inbox:unanswered",
      kind: "unanswered_messages",
      urgency: "later",
      subject: unansweredMessagesSubjectText(t, {
        messages: unanswered,
        dateRequests: openDateRequests,
      }),
      context: null,
      // The count is the row (see `unansweredMessagesSubjectText`).
      detail: "",
      actionLabel: unanswered > 0 ? openInboxActionText(t) : openDateRequestsActionText(t),
      href: unanswered > 0 ? `/shop/${shopSlug}/inbox` : `/shop/${shopSlug}/requests`,
      dueAt: null,
    });
  }
}
