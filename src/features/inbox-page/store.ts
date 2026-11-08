import { assistsAvailable } from "@/features/assists";
import { inboxSeats } from "@/features/inbox-seats";
import type { AppDb } from "../../db/client";
import { pagedInboxMessages } from "../../db/inbound-messages";

/** The triage the page schedules after its response, while assists are on. */
export { awaitsTriage, triageInboundMessagesSafely } from "@/features/inbox-assists";

/**
 * The inbox's question in one call: one page of messages, whether the shop's
 * assists are on, and the departures each message could be about (the
 * late-window seats, or the seats they held when they wrote) as of `now`.
 */
export async function getInboxPage(
  db: AppDb,
  shopId: string,
  options: { page: number; now: Date },
) {
  const [messages, assists] = await Promise.all([
    pagedInboxMessages(db, shopId, { page: options.page }),
    assistsAvailable(db, shopId),
  ]);
  const seats = await inboxSeats(
    db,
    shopId,
    messages.rows.map((row) => row.message),
    options.now,
  );
  return { messages, assists, seats };
}
