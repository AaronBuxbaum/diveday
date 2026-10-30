"use server";

import { notFound } from "next/navigation";
import { z } from "zod";
import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  deleteStrangerInboundMessage,
  getInboundMessage,
  markInboundAnswered,
  reopenInboundMessage,
} from "@/db/inbound-messages";
import { markMessageRunningLate } from "@/db/running-late";
import { nowDate } from "@/lib/clock";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/** A row's "⋯" posts its message id, and Done/Reopen says which (issue #2233). */
const messageForm = z.object({ messageId: z.string().default(""), done: z.string().optional() });

/** "Mark running late for {trip}" posts the message and the seat the desk chose (issue #2551). */
const doneMessageForm = messageForm.extend({ receivedAt: z.iso.datetime() });

const lateForm = z.object({
  messageId: z.string().default(""),
  bookingId: z.string().default(""),
});

/** The shared live-staff and shop-binding gate for inbox writes. */
async function requireInboxActionContext() {
  const session = await requireStaffSession();
  const inbox = shopPath(session.user.shopSlug, "inbox");
  const db = await getDb();
  if (!(await loadActiveStaffRoles(db, session.user.shopId, session.user.personId))) notFound();
  return { session, inbox, db };
}

/**
 * **Delete a message from a sender nobody on the roster holds** (issue #1506;
 * ADR 20260907-two-way-inbox, decision 9 and its delete amendment).
 *
 * A row with `person_id` null has no record behind it, so it has no door and
 * no composer — and it counted against Today's `unanswered_messages` for as
 * long as it existed, with nothing on any surface able to clear it. This is
 * that missing write: the stranger's row leaves the worklist and the Today
 * count in one stamp, because `deleteStrangerInboundMessage` sets
 * `deleted_at` and both `pagedInboxMessages` and `countUnansweredMessages`
 * read through `liveMessage`.
 *
 * **The gate is a live staff session and nothing more** — the surface's own
 * gate since the 2026-09-10 amendment (issues #1505/#1518), which deleted
 * `canPersonAnswerShopInbox` rather than relaxing it. `requireStaffSession`
 * re-reads the account's live roles on every request, so a demoted, disabled
 * or deleted staffer loses this on their next request rather than at their
 * next sign-in. Do not reintroduce a predicate here without amending that
 * decision: a staffer who may read the stranger's message and its address is
 * the staffer the owner decided may clear it.
 *
 * The tenant is the session's shop, never a slug the form carried: the delete
 * is scoped by `session.user.shopId`, so an id belonging to another shop
 * matches no row and answers the same "no longer in the inbox" a
 * second click on the same row gets.
 *
 * **Which row may go is the query's business, not the component's.**
 * `deleteStrangerInboundMessage` carries `person_id is null` in its own
 * `where`, so a diver-linked id posted by hand answers "gone" like any other
 * id that names no deletable row. The render guard in `InboxRow` decides what
 * a staffer is offered; it cannot decide what the server accepts.
 */
export async function deleteInboxMessageAction(formData: FormData): Promise<void> {
  const { session, inbox, db } = await requireInboxActionContext();

  // A posted id is caller-controlled, so it is narrowed before it reaches a
  // `uuid` comparison — an unparseable one would otherwise be a 500 rather
  // than a refusal (src/lib/uuid.ts). It answers `gone` rather than a code of
  // its own: a string that is not an id names no row, which is the same thing
  // a wrong-tenant or already-deleted id means, and the staffer's next move is
  // identical either way.
  const parsed = parseForm(messageForm, formData);
  const messageId = parsed.ok ? uuidParam(parsed.data.messageId) : null;
  if (!messageId) revalidateAndRedirect(inbox, noticeUrl(inbox, "gone"));

  const deleted = await deleteStrangerInboundMessage(db, session.user.shopId, messageId);
  revalidateAndRedirect(inbox, noticeUrl(inbox, deleted ? "deleted" : "gone"));
}

/**
 * **Mark a message done, or put it back on the worklist** (the row's "⋯").
 *
 * Done is one state for "answered somewhere else" and "no longer relevant":
 * both mean nobody here owes this message anything, which is all the worklist
 * and Today's `unanswered_messages` ask. It is the same `answered_at` stamp a
 * sent reply writes, so a message answered from the diver's record and one
 * marked done here land in the same group. `done=false` clears it, for a
 * message marked done too early.
 *
 * Same gate and the same tenant binding as the delete above, for the same
 * reasons; any message of the shop qualifies, a diver's or a stranger's. The
 * moved row is its own confirmation, so success redirects with no notice.
 */
export async function setInboxMessageDoneAction(formData: FormData): Promise<void> {
  const { session, inbox, db } = await requireInboxActionContext();

  const parsed = parseForm(doneMessageForm, formData);
  const messageId = parsed.ok ? uuidParam(parsed.data.messageId) : null;
  if (!parsed.ok || !messageId) revalidateAndRedirect(inbox, noticeUrl(inbox, "gone"));

  const done = parsed.data.done !== "false";
  const receivedAt = new Date(parsed.data.receivedAt);
  const changed = done
    ? await markInboundAnswered(db, session.user.shopId, messageId, nowDate(), receivedAt)
    : await reopenInboundMessage(db, session.user.shopId, messageId, receivedAt);
  revalidateAndRedirect(inbox, changed ? inbox : noticeUrl(inbox, "gone"));
}

/**
 * **Mark the sender running late, from what they wrote** (UX review
 * 2026-10-13, item 19). "Running about 15 min late, traffic on the causeway"
 * sat in the Inbox while the manifest said nothing; this puts the same mark
 * the diver's own tap sets on the seat the row named, so the roster and the
 * manifest show it.
 *
 * Same gate and the same tenant binding as the acts above. **A message id and
 * the booking id the desk chose are posted** (issue #2551: a sender holding two
 * seats inside the window gets one act per seat). The person comes from the
 * stored message, inside the session's shop, and `markMessageRunningLate`
 * re-derives the seats the message could be about and refuses any other
 * booking id, so a hand-built form can name neither somebody else's seat nor a
 * boat the message was not about. The message text is never read (ADR
 * 20260909-reply-keywords). The mark gates nothing (src/lib/running-late.ts),
 * which is why any live staff role may set it.
 */
export async function markInboxSenderLateAction(formData: FormData): Promise<void> {
  const { session, inbox, db } = await requireInboxActionContext();

  const parsed = parseForm(lateForm, formData);
  const messageId = parsed.ok ? uuidParam(parsed.data.messageId) : null;
  const bookingId = parsed.ok ? uuidParam(parsed.data.bookingId) : null;
  if (!parsed.ok || !messageId || !bookingId) {
    revalidateAndRedirect(inbox, noticeUrl(inbox, "gone"));
  }

  const message = await getInboundMessage(db, session.user.shopId, messageId);
  if (!message?.personId) revalidateAndRedirect(inbox, noticeUrl(inbox, "gone"));

  const outcome = await markMessageRunningLate(db, {
    shopId: session.user.shopId,
    personId: message.personId,
    bookingId,
    receivedAt: message.receivedAt,
    now: nowDate(),
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    inbox,
    noticeUrl(inbox, outcome.status === "closed" ? "late-closed" : "late-marked"),
  );
}
