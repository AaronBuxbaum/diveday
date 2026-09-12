"use server";

import { notFound } from "next/navigation";
import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { deleteStrangerInboundMessage } from "@/db/inbound-messages";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

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
  const session = await requireStaffSession();
  const inbox = shopPath(session.user.shopSlug, "inbox");
  const db = await getDb();

  // `requireStaffSession` re-reads the account's live roles by *person*, and
  // says in as many words that checking the session's claimed `shopId` is
  // somebody else's job (`loadActiveStaffRolesByPerson`, src/db/authz.ts).
  // A staff page borrows that check from `requireShopSurface`, and a gated
  // mutation borrows it from its own `canPerson*` call. This one has no gate
  // to borrow it from, so it asserts the binding itself rather than trusting
  // a signed claim on its own (ADR-0006, the server re-checks).
  if (!(await loadActiveStaffRoles(db, session.user.shopId, session.user.personId))) notFound();

  // A posted id is caller-controlled, so it is narrowed before it reaches a
  // `uuid` comparison — an unparseable one would otherwise be a 500 rather
  // than a refusal (src/lib/uuid.ts). It answers `gone` rather than a code of
  // its own: a string that is not an id names no row, which is the same thing
  // a wrong-tenant or already-deleted id means, and the staffer's next move is
  // identical either way.
  const messageId = uuidParam(String(formData.get("messageId") ?? ""));
  if (!messageId) revalidateAndRedirect(inbox, noticeUrl(inbox, "gone"));

  const deleted = await deleteStrangerInboundMessage(db, session.user.shopId, messageId);
  revalidateAndRedirect(inbox, noticeUrl(inbox, deleted ? "deleted" : "gone"));
}
