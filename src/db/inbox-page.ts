import { assistsAvailable } from "./assists";
import type { AppDb } from "./client";
import { pagedInboxMessages } from "./inbound-messages";
import { inboxSeats } from "./inbox-seats";

/** The triage the page schedules after its response, while assists are on. */
export { awaitsTriage, triageInboundMessagesSafely } from "./inbox-assists";

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
