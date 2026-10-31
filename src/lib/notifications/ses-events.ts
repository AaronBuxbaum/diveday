import { z } from "zod";
import { type ProviderEmailStatus, timestampFrom } from "./events";
import { SES_KIND_TAG, SES_PURPOSE_TAG, SES_SENDER_TAG, SES_SHOP_TAG } from "./ses-tags";

/**
 * Turns a verified SES event (the JSON carried inside an SNS `Notification`
 * message's `Message` field) into the shared `ProviderEmailStatus` delivery
 * outcome, so `/api/webhooks/ses` can hand it off to `applyProviderEmailEvent`
 * — the same downstream dashboard/issue-surfacing code every provider's event
 * mapping (SMS, WhatsApp) uses. `Open` and `Click` are handled by a separate
 * engagement-tracking path, not this delivery-status one (and are never
 * enabled — see the no-opens/no-clicks privacy stance in
 * docs/engineering/ses-email-runbook.md); `Subscription` and anything
 * unmodeled reduce to `ignored`.
 */
const PROVIDER_STATUS_BY_SES_EVENT_TYPE = {
  Send: "sent",
  Delivery: "delivered",
  DeliveryDelay: "delivery_delayed",
  Bounce: "bounced",
  Complaint: "complained",
  Reject: "failed",
  RenderingFailure: "failed",
} as const satisfies Record<string, ProviderEmailStatus>;

const recipientSchema = z.object({ emailAddress: z.string().optional() });

const sesEventDataSchema = z.object({
  eventType: z.string().min(1),
  mail: z.object({
    messageId: z.string().min(1),
    timestamp: z.string().min(1).optional(),
    destination: z.array(z.string()).optional(),
    /** The `EmailTags` the adapter set on the send, echoed back as `name -> [values]`. */
    tags: z.record(z.string(), z.array(z.string())).optional(),
  }),
  bounce: z
    .object({
      timestamp: z.string().optional(),
      bounceType: z.string().optional(),
      bounceSubType: z.string().optional(),
      bouncedRecipients: z
        .array(recipientSchema.extend({ diagnosticCode: z.string().optional() }))
        .optional(),
    })
    .optional(),
  complaint: z
    .object({
      timestamp: z.string().optional(),
      complaintFeedbackType: z.string().optional(),
      complainedRecipients: z.array(recipientSchema).optional(),
    })
    .optional(),
  delivery: z.object({ timestamp: z.string().optional() }).optional(),
  deliveryDelay: z
    .object({ timestamp: z.string().optional(), delayType: z.string().optional() })
    .optional(),
  reject: z.object({ reason: z.string().optional() }).optional(),
  failure: z.object({ errorMessage: z.string().optional() }).optional(),
});

export type SesEmailEvent =
  | {
      kind: "delivery";
      providerMessageId: string;
      status: ProviderEmailStatus;
      /** The provider's explanation for a bounce, complaint, reject, or rendering failure, when it gave one. */
      detail: string | null;
      occurredAt: Date;
      /**
       * The address the verdict is about — the recipient SES names on a
       * bounce or complaint, else the message's first destination. Lower-cased
       * and trimmed; `null` when the event names nobody.
       */
      recipient: string | null;
      /**
       * The tenant the send belonged to, read off the `diveday_shop` message
       * tag the adapter sets (`SES_SHOP_TAG`). `null` for mail sent before the
       * tag existed or by anything other than the app.
       */
      shopId: string | null;
    }
  | { kind: "ignored" };

const shopIdSchema = z.uuid();

export type SesEventData = z.infer<typeof sesEventDataSchema>;

/** Decodes and validates the shared SES event shape; malformed input returns null. */
export function parseSesEventData(rawMessage: string): SesEventData | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  const parsed = sesEventDataSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

function recipientOf(data: z.infer<typeof sesEventDataSchema>): string | null {
  const named =
    data.complaint?.complainedRecipients?.[0]?.emailAddress ??
    data.bounce?.bouncedRecipients?.[0]?.emailAddress ??
    data.mail.destination?.[0];
  const address = named?.trim().toLowerCase();
  return address ? address : null;
}

function shopIdOf(data: z.infer<typeof sesEventDataSchema>): string | null {
  const parsed = shopIdSchema.safeParse(data.mail.tags?.[SES_SHOP_TAG]?.[0]);
  return parsed.success ? parsed.data : null;
}

/**
 * A bounce's diagnostic, reduced to its SMTP reply and enhanced status codes
 * (`550 5.1.1`), or null when it carries neither (issue #2531). The rest is the
 * remote server's free text, which routinely quotes the recipient's address
 * (`550 5.1.1 <nora@example.com>: Recipient address rejected`), and this detail
 * is stored on the delivery row. The codes are the diagnosis; the prose is not
 * needed to act on it.
 */
export function smtpStatusOf(diagnostic: string): string | null {
  // Neither may sit inside a longer dotted number, an IP address above all.
  const reply = diagnostic.match(/(?<![\w.])[245]\d\d(?![\w.])/)?.[0];
  const enhanced = diagnostic.match(/(?<![\w.])[245]\.\d{1,3}\.\d{1,3}(?![\w.])/)?.[0];
  const status = [reply, enhanced].filter(Boolean).join(" ");
  return status ? status : null;
}

function sesEventDetail(data: z.infer<typeof sesEventDataSchema>): string | null {
  const diagnostic = data.bounce?.bouncedRecipients?.[0]?.diagnosticCode;
  const bounceStatus = diagnostic ? smtpStatusOf(diagnostic) : null;
  if (bounceStatus) return bounceStatus;
  const bounceClassification = [data.bounce?.bounceType, data.bounce?.bounceSubType]
    .filter(Boolean)
    .join(" / ");
  if (bounceClassification) return bounceClassification;
  const complaintType = data.complaint?.complaintFeedbackType?.trim();
  if (complaintType) return complaintType;
  const rejectReason = data.reject?.reason?.trim();
  if (rejectReason) return rejectReason;
  const failureMessage = data.failure?.errorMessage?.trim();
  if (failureMessage) return failureMessage;
  return null;
}

export function sesEmailEventFromData(data: SesEventData | null, now: Date): SesEmailEvent {
  if (!data) return { kind: "ignored" };
  const status =
    PROVIDER_STATUS_BY_SES_EVENT_TYPE[
      data.eventType as keyof typeof PROVIDER_STATUS_BY_SES_EVENT_TYPE
    ];
  if (!status) return { kind: "ignored" };

  return {
    kind: "delivery",
    providerMessageId: data.mail.messageId,
    status,
    detail: sesEventDetail(data),
    recipient: recipientOf(data),
    shopId: shopIdOf(data),
    occurredAt: timestampFrom(
      [
        data.bounce?.timestamp,
        data.complaint?.timestamp,
        data.delivery?.timestamp,
        data.deliveryDelay?.timestamp,
        data.mail.timestamp,
      ],
      now,
    ),
  };
}

/** One recipient a bounce or complaint named, as `email_bounces` keeps it. */
export type SesBounceReport = {
  providerMessageId: string;
  event: "bounce" | "complaint";
  recipient: string;
  bounceType: string | null;
  bounceSubType: string | null;
  smtpStatus: string | null;
  complaintType: string | null;
  kind: string | null;
  purpose: string | null;
  shopId: string | null;
  /** The `diveday_sender` tag: the staff member whose action sent it. */
  sentByPersonId: string | null;
  occurredAt: Date;
};

function uuidOrNull(value: string | undefined): string | null {
  const parsed = shopIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Every recipient a `Bounce` or `Complaint` names, one report each, with the
 * classification SES gave it and the email it was (the `diveday_kind` and
 * `diveday_purpose` tags). Other event types return no reports. Kept apart from
 * `sesEmailEventFromData`, which reduces an event to one verdict on one
 * message; this is the per-address record DiveDay keeps to debug its own mail.
 * A recipient SES did not name falls back to the message's destinations, as
 * `recipientOf` does.
 */
export function sesBounceReportsFromData(data: SesEventData | null, now: Date): SesBounceReport[] {
  if (!data) return [];
  const common = {
    providerMessageId: data.mail.messageId,
    kind: trimmedOrNull(data.mail.tags?.[SES_KIND_TAG]?.[0]),
    purpose: trimmedOrNull(data.mail.tags?.[SES_PURPOSE_TAG]?.[0]),
    shopId: shopIdOf(data),
    sentByPersonId: uuidOrNull(data.mail.tags?.[SES_SENDER_TAG]?.[0]),
  };
  const destinations = (data.mail.destination ?? []).map((address) => ({ emailAddress: address }));
  const addressOf = (recipient: { emailAddress?: string }) =>
    recipient.emailAddress?.trim().toLowerCase() || null;

  if (data.eventType === "Bounce" && data.bounce) {
    const { bounce } = data;
    const named = bounce.bouncedRecipients?.length ? bounce.bouncedRecipients : destinations;
    const occurredAt = timestampFrom([bounce.timestamp, data.mail.timestamp], now);
    return named.flatMap((recipient) => {
      const address = addressOf(recipient);
      if (!address) return [];
      const diagnostic = "diagnosticCode" in recipient ? recipient.diagnosticCode : undefined;
      return [
        {
          ...common,
          event: "bounce" as const,
          recipient: address,
          bounceType: trimmedOrNull(bounce.bounceType),
          bounceSubType: trimmedOrNull(bounce.bounceSubType),
          smtpStatus: diagnostic ? smtpStatusOf(diagnostic) : null,
          complaintType: null,
          occurredAt,
        },
      ];
    });
  }

  if (data.eventType === "Complaint" && data.complaint) {
    const { complaint } = data;
    const named = complaint.complainedRecipients?.length
      ? complaint.complainedRecipients
      : destinations;
    const occurredAt = timestampFrom([complaint.timestamp, data.mail.timestamp], now);
    return named.flatMap((recipient) => {
      const address = addressOf(recipient);
      if (!address) return [];
      return [
        {
          ...common,
          event: "complaint" as const,
          recipient: address,
          bounceType: null,
          bounceSubType: null,
          smtpStatus: null,
          complaintType: trimmedOrNull(complaint.complaintFeedbackType),
          occurredAt,
        },
      ];
    });
  }

  return [];
}

/** The kind tag a month-end send carries (`kinds.ts`). */
const BOOKKEEPER_MONTH_END_KIND = "bookkeeper_month_end";

/** What a month-end send's event says about the bookkeeper's address. */
export type SesBookkeeperOutcome = {
  shopId: string;
  recipient: string;
  outcome: "bounced" | "delivered";
  occurredAt: Date;
};

/**
 * **A month-end send's outcome** (issue #2798): for a message tagged
 * `bookkeeper_month_end` with a shop, a permanent bounce (which is also how SES
 * answers an address on its suppression list, `OnAccountSuppressionList` or
 * `Suppressed`) reads `bounced` and a delivery reads `delivered`, one per
 * address named. A transient bounce, a complaint, any other kind and an
 * untagged message read nothing: a mailbox that is full today must not mark the
 * address wrong. Matched to the shop by its tag, never by a stored message id,
 * since this kind keeps no delivery row.
 */
export function sesBookkeeperOutcomesFromData(
  data: SesEventData | null,
  now: Date,
): SesBookkeeperOutcome[] {
  if (!data) return [];
  if (trimmedOrNull(data.mail.tags?.[SES_KIND_TAG]?.[0]) !== BOOKKEEPER_MONTH_END_KIND) return [];
  const shopId = shopIdOf(data);
  if (!shopId) return [];
  const destinations = (data.mail.destination ?? []).map((address) => ({ emailAddress: address }));
  const outcomes = (
    named: readonly { emailAddress?: string }[],
    outcome: SesBookkeeperOutcome["outcome"],
    occurredAt: Date,
  ) =>
    named.flatMap((recipient) => {
      const address = recipient.emailAddress?.trim().toLowerCase();
      return address ? [{ shopId, recipient: address, outcome, occurredAt }] : [];
    });

  if (data.eventType === "Bounce" && data.bounce?.bounceType === "Permanent") {
    const named = data.bounce.bouncedRecipients?.length
      ? data.bounce.bouncedRecipients
      : destinations;
    return outcomes(
      named,
      "bounced",
      timestampFrom([data.bounce.timestamp, data.mail.timestamp], now),
    );
  }
  if (data.eventType === "Delivery") {
    return outcomes(
      destinations,
      "delivered",
      timestampFrom([data.delivery?.timestamp, data.mail.timestamp], now),
    );
  }
  return [];
}
