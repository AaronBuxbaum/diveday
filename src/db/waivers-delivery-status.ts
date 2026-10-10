/**
 * Waivers: how a signing request reached the diver — per-channel delivery
 * rows and the one status staff read. Imported through the `./waivers` barrel.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { notificationDeliveries, waiverDeliveries, waiverRecords } from "./schema";
import type { WaiverDeliveryChannel } from "./waivers-templates";

/**
 * How far the diver's outstanding waiver has actually got.
 *
 * `link_copied` sits between `not_sent` and `not_signed` because a copied link
 * is genuinely between them: a live release exists and a staffer has the URL,
 * and nothing DiveDay can see has reached the diver. Reporting it as
 * `not_signed` (which the surface words as "sent") credited us with a delivery
 * that never happened; reporting it as `not_sent` would deny the link exists
 * and offer to issue another.
 */
export type DiverWaiverRequestStatus = "not_sent" | "failed" | "link_copied" | "not_signed";

/**
 * Persist the delivery outcome on the waiver itself, including person-scoped
 * links — twice, deliberately, and to answer two different questions.
 *
 * The columns on `waiver_records` are **the latest attempt on this link**,
 * whichever way it went: the delivery webhook keys on them, and
 * `getDiverWaiverRequestStatus` reads them for "has this diver been reached at
 * all?". The `waiver_deliveries` row is **this channel's** current state, and
 * it exists because tapping Text must not erase what we knew about the email.
 */
export async function recordWaiverDelivery(
  db: DbExecutor,
  input: {
    shopId: string;
    waiverRecordId: string;
    channel: WaiverDeliveryChannel;
    delivery: {
      status: "sent" | "failed" | "not_configured";
      providerMessageId?: string;
      detail?: string;
    };
    now?: Date;
  },
) {
  const providerStatus = null;
  const deliveryStatus =
    input.delivery.status === "sent"
      ? ("sent" as const)
      : input.delivery.status === "not_configured"
        ? ("not_configured" as const)
        : ("failed" as const);
  const detail = input.delivery.status === "failed" ? (input.delivery.detail ?? null) : null;
  const attemptedAt = input.now ?? nowDate();
  await db
    .update(waiverRecords)
    .set({
      deliveryStatus,
      deliveryProviderMessageId: input.delivery.providerMessageId ?? null,
      deliveryProviderStatus: providerStatus,
      deliveryProviderStatusAt: null,
      deliveryError: detail,
    })
    .where(eq(waiverRecords.id, input.waiverRecordId));
  // Current state per channel, so a second send on the same channel replaces
  // its row rather than stacking one. Any provider verdict already on the row
  // is cleared: it belonged to the message this attempt just superseded.
  await db
    .insert(waiverDeliveries)
    .values({
      shopId: input.shopId,
      waiverRecordId: input.waiverRecordId,
      channel: input.channel,
      status: deliveryStatus,
      providerMessageId: input.delivery.providerMessageId ?? null,
      detail,
      attemptedAt,
    })
    .onConflictDoUpdate({
      target: [waiverDeliveries.waiverRecordId, waiverDeliveries.channel],
      set: {
        status: deliveryStatus,
        providerMessageId: input.delivery.providerMessageId ?? null,
        providerStatus: null,
        providerStatusAt: null,
        detail,
        attemptedAt,
      },
    });
}

/**
 * The provider verdicts that mean a message that left DiveDay never landed.
 * Shared by the diver's overall request status and the per-channel one, so a
 * bounce can never read as delivered on one surface and failed on another.
 */
const FAILED_PROVIDER_STATUSES = new Set(["bounced", "complained", "failed", "suppressed"]);

/**
 * What a channel button on the diver record should wear. `unknown` is the
 * honest answer for a channel nobody has tried on this link — and the reason
 * this is a five-state code rather than a boolean.
 *
 * `copied` is the `link` channel's only success, and it is deliberately not
 * `sent`: a staffer taking the URL means *they* have it, and nothing at all
 * about whether the diver does. Where it went next — a WhatsApp message, a
 * text from the staffer's own phone, a laptop turned round on the counter —
 * happened outside DiveDay, so claiming a send would be inventing an event we
 * never saw. `sent` never appears on the link channel and `copied` never
 * appears on the other two.
 */
export type WaiverChannelDeliveryState =
  | "unknown"
  | "sent"
  | "copied"
  | "failed"
  | "not_configured";

export type WaiverChannelDeliveryStates = Record<WaiverDeliveryChannel, WaiverChannelDeliveryState>;

const NO_WAIVER_CHANNEL_STATES: WaiverChannelDeliveryStates = {
  email: "unknown",
  text: "unknown",
  link: "unknown",
};

/**
 * Per-channel delivery state for the diver's current outstanding waiver link.
 *
 * Scoped to the *pending, unsuperseded* record on purpose: a channel's outcome
 * describes one link, so carrying last month's bounce onto a link issued this
 * morning would be a button lying about a message that was never sent. When
 * there is no such record — nothing outstanding — every channel is `unknown`.
 */
export async function getDiverWaiverChannelStates(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<WaiverChannelDeliveryStates> {
  const [record] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .orderBy(desc(waiverRecords.createdAt))
    .limit(1);
  if (!record) return NO_WAIVER_CHANNEL_STATES;

  const rows = await db
    .select({
      channel: waiverDeliveries.channel,
      status: waiverDeliveries.status,
      providerStatus: waiverDeliveries.providerStatus,
    })
    .from(waiverDeliveries)
    .where(
      and(eq(waiverDeliveries.shopId, shopId), eq(waiverDeliveries.waiverRecordId, record.id)),
    );

  const states: WaiverChannelDeliveryStates = { ...NO_WAIVER_CHANNEL_STATES };
  for (const row of rows) {
    // A provider verdict outranks our own send result: "we handed it to SES"
    // and "SES says it bounced" are both true, and only the second one matters
    // to a staffer deciding whether to try another way.
    if (row.providerStatus && FAILED_PROVIDER_STATUSES.has(row.providerStatus)) {
      states[row.channel] = "failed";
      continue;
    }
    // The link channel stores `sent` — those columns answer "is there a live
    // link", and there is — but it must never *read* as sent. Nothing was
    // delivered; a staffer picked the URL up.
    states[row.channel] = row.channel === "link" && row.status === "sent" ? "copied" : row.status;
  }
  return states;
}

/**
 * The delivery state of the latest outstanding waiver request for one diver.
 * A missing delivery row is treated as a failed handoff: the waiver record
 * can exist even when there was no usable email/origin to attempt delivery.
 */
export async function getDiverWaiverRequestStatus(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<DiverWaiverRequestStatus> {
  const [row] = await db
    .select({
      recordId: waiverRecords.id,
      recordDeliveryStatus: waiverRecords.deliveryStatus,
      recordProviderStatus: waiverRecords.deliveryProviderStatus,
      deliveryStatus: notificationDeliveries.status,
      providerStatus: notificationDeliveries.providerStatus,
    })
    .from(waiverRecords)
    .leftJoin(
      notificationDeliveries,
      and(
        eq(notificationDeliveries.shopId, shopId),
        eq(notificationDeliveries.bookingId, waiverRecords.bookingId),
        eq(notificationDeliveries.kind, "waiver_request"),
      ),
    )
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .orderBy(desc(waiverRecords.createdAt))
    .limit(1);

  if (!row) return "not_sent";
  const deliveryStatus = row.recordDeliveryStatus ?? row.deliveryStatus;
  const providerStatus = row.recordProviderStatus ?? row.providerStatus;
  if (
    deliveryStatus !== "sent" ||
    (providerStatus !== null && FAILED_PROVIDER_STATUSES.has(providerStatus))
  ) {
    return "failed";
  }
  // The record's columns are the latest attempt *whichever way it went*, so a
  // "Copy link" tap after a real email leaves them saying `sent` about a
  // handover nobody watched. The per-channel rows are where the two are still
  // told apart: a message actually left DiveDay only if some channel other
  // than `link` is standing at `sent`.
  //
  // A second query rather than a join: this runs on an executor that may be a
  // transaction (one checked-out client), and it is only reached for a diver
  // who has an outstanding link at all.
  const channelRows = await db
    .select({ channel: waiverDeliveries.channel, status: waiverDeliveries.status })
    .from(waiverDeliveries)
    .where(
      and(eq(waiverDeliveries.shopId, shopId), eq(waiverDeliveries.waiverRecordId, row.recordId)),
    );
  // No per-channel rows at all means the record's own columns are all we have,
  // and they say a message went — the notification-table fallback lands here.
  if (channelRows.length === 0) return "not_signed";
  // Reaching this line means the latest attempt stood at `sent`. If no channel
  // other than `link` is standing there, the only thing that can have set it is
  // a staffer taking the URL.
  return channelRows.some(
    (channelRow) => channelRow.channel !== "link" && channelRow.status === "sent",
  )
    ? "not_signed"
    : "link_copied";
}
