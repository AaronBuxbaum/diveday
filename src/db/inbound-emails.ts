import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { emailAddressOf, senderNameOf } from "@/lib/notifications/inbound";
import type { AppDb } from "./client";
import { findMailboxForAddress, type PlatformAccess } from "./platform-mailboxes";
import { inboundEmails, platformMailboxes } from "./schema";

/**
 * Mail received at DiveDay's own domain
 * (20260724-resend-webhook-email-events). Resend delivers every address at the
 * domain through one webhook, so routing is this module's job: match the
 * recipient to a `platform_mailboxes` row, or file it unrouted.
 */

export type InboundEmailInput = {
  providerEmailId: string;
  from: string;
  /** Every address the message reached us by — `to`, `cc`, and the envelope recipient. */
  recipients: string[];
  subject: string | null;
  textBody: string;
  hasAttachments: boolean;
  receivedAt: Date;
};

/**
 * A received body is stored, not rendered as markup, but it is still
 * attacker-controlled and unbounded — a mail loop or a pasted log can be
 * megabytes. Long bodies are truncated at ingest.
 */
export const MAX_INBOUND_BODY_LENGTH = 20_000;

export function truncateInboundBody(body: string): string {
  if (body.length <= MAX_INBOUND_BODY_LENGTH) return body;
  return `${body.slice(0, MAX_INBOUND_BODY_LENGTH)}\n\n[truncated]`;
}

/**
 * The body is not the only unbounded thing a sender controls: `Subject`,
 * `From`, and the recipient list are theirs too, and every column here is an
 * unbounded `text`. These caps are generous against real mail (RFC 5321 puts a
 * path at 256 octets; a subject over 500 characters is already pathological)
 * and cheap against a sender who sends a megabyte of header.
 */
const MAX_ADDRESS_LENGTH = 320;
const MAX_SUBJECT_LENGTH = 500;

/**
 * Recipients are walked with one query each, so an uncapped `cc` list is a
 * database round-trip multiplier inside the webhook handler. A message that
 * reaches DiveDay on more than this many addresses is not one we need to route
 * precisely.
 */
export const MAX_INBOUND_RECIPIENTS = 20;

const bounded = (value: string, max: number): string => value.slice(0, max);

export type InboundRouting = { mailboxId: string | null; toEmail: string };

/**
 * Which mailbox a message belongs to, decided purely by the address it was
 * sent to. The first recipient that matches a live mailbox wins; failing that
 * the first parseable recipient is recorded so an unrouted message still shows
 * *what* was addressed — usually a typo or a retired alias.
 */
export async function routeInboundEmail(
  db: AppDb,
  recipients: readonly string[],
): Promise<InboundRouting> {
  let firstParseable: string | null = null;
  for (const recipient of recipients.slice(0, MAX_INBOUND_RECIPIENTS)) {
    const address = emailAddressOf(recipient);
    if (!address) continue;
    firstParseable ??= bounded(address, MAX_ADDRESS_LENGTH);
    const mailbox = await findMailboxForAddress(db, address);
    if (mailbox) return { mailboxId: mailbox.id, toEmail: bounded(address, MAX_ADDRESS_LENGTH) };
  }
  return { mailboxId: null, toEmail: firstParseable ?? "" };
}

export type RecordInboundEmailResult = { id: string; duplicate: boolean };

/**
 * Files a received message. Idempotent on the provider's own email id, because
 * webhook delivery is at-least-once: a redelivered event must land on the same
 * row rather than a second copy in the inbox. A duplicate is reported, not
 * updated — the first version of a message is the one that arrived.
 */
export async function recordInboundEmail(
  db: AppDb,
  input: InboundEmailInput & InboundRouting,
): Promise<RecordInboundEmailResult> {
  const [existing] = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(eq(inboundEmails.providerEmailId, input.providerEmailId))
    .limit(1);
  if (existing) return { id: existing.id, duplicate: true };

  const [row] = await db
    .insert(inboundEmails)
    .values({
      mailboxId: input.mailboxId,
      providerEmailId: input.providerEmailId,
      fromEmail: bounded(emailAddressOf(input.from) ?? input.from, MAX_ADDRESS_LENGTH),
      fromName: senderNameOf(input.from)?.slice(0, MAX_ADDRESS_LENGTH) ?? null,
      toEmail: bounded(input.toEmail, MAX_ADDRESS_LENGTH),
      subject: input.subject?.slice(0, MAX_SUBJECT_LENGTH) ?? null,
      textBody: truncateInboundBody(input.textBody),
      hasAttachments: input.hasAttachments,
      receivedAt: input.receivedAt,
    })
    // Two concurrent redeliveries can both miss the select above; the unique
    // index is the real guard and this makes losing that race a no-op.
    .onConflictDoNothing({ target: inboundEmails.providerEmailId })
    .returning({ id: inboundEmails.id });
  if (row) return { id: row.id, duplicate: false };

  const [raced] = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(eq(inboundEmails.providerEmailId, input.providerEmailId))
    .limit(1);
  return { id: raced?.id ?? "", duplicate: true };
}

export type InboundEmailView = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string | null;
  textBody: string;
  hasAttachments: boolean;
  receivedAt: Date;
  handledAt: Date | null;
  /** Null for unrouted mail, which only a platform admin ever sees. */
  mailboxAddress: string | null;
};

/**
 * The mail this person may read, newest first.
 *
 * Authorization lives in the `where`, not in the caller: a member sees only
 * mailboxes they belong to, and unrouted mail — which by definition nobody
 * owns — is admin-only. A person with neither gets an empty list rather than a
 * query that happens to return nothing.
 */
export async function listInboundEmails(
  db: AppDb,
  access: PlatformAccess,
  options: { includeHandled?: boolean } = {},
): Promise<InboundEmailView[]> {
  const scope = access.isAdmin
    ? undefined
    : access.mailboxIds.length > 0
      ? inArray(inboundEmails.mailboxId, access.mailboxIds)
      : null;
  if (scope === null) return [];

  const rows = await db
    .select({ email: inboundEmails, mailboxAddress: platformMailboxes.address })
    .from(inboundEmails)
    .leftJoin(platformMailboxes, eq(platformMailboxes.id, inboundEmails.mailboxId))
    .where(and(scope, options.includeHandled ? undefined : isNull(inboundEmails.handledAt)))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(200);

  return rows.map((row) => ({
    id: row.email.id,
    fromEmail: row.email.fromEmail,
    fromName: row.email.fromName,
    toEmail: row.email.toEmail,
    subject: row.email.subject,
    textBody: row.email.textBody,
    hasAttachments: row.email.hasAttachments,
    receivedAt: row.email.receivedAt,
    handledAt: row.email.handledAt,
    mailboxAddress: row.mailboxAddress,
  }));
}

/** How much mail is waiting on this person. */
export async function countUnhandledInboundEmails(
  db: AppDb,
  access: PlatformAccess,
): Promise<number> {
  const scope = access.isAdmin
    ? undefined
    : access.mailboxIds.length > 0
      ? inArray(inboundEmails.mailboxId, access.mailboxIds)
      : null;
  if (scope === null) return 0;

  const [row] = await db
    .select({ waiting: count() })
    .from(inboundEmails)
    .where(and(scope, isNull(inboundEmails.handledAt)));
  return row?.waiting ?? 0;
}

/**
 * Marks a message dealt with, or puts it back. The same access scope as the
 * list is repeated in the `where`, so an id for a mailbox this person doesn't
 * belong to matches nothing rather than flipping its state.
 */
export async function setInboundEmailHandled(
  db: AppDb,
  input: {
    access: PlatformAccess;
    inboundEmailId: string;
    handled: boolean;
    byPersonId: string;
    now?: Date;
  },
): Promise<boolean> {
  const { access } = input;
  const scope = access.isAdmin
    ? undefined
    : access.mailboxIds.length > 0
      ? inArray(inboundEmails.mailboxId, access.mailboxIds)
      : null;
  if (scope === null) return false;

  const updated = await db
    .update(inboundEmails)
    .set(
      input.handled
        ? { handledAt: input.now ?? nowDate(), handledByPersonId: input.byPersonId }
        : { handledAt: null, handledByPersonId: null },
    )
    .where(and(eq(inboundEmails.id, input.inboundEmailId), scope))
    .returning({ id: inboundEmails.id });
  return updated.length > 0;
}
