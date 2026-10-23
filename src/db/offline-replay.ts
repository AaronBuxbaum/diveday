import { violatesUniqueIndex } from "./query-helpers";

/**
 * **An offline replay that collided with its own first copy is a duplicate,
 * not a 500.**
 *
 * The device gives up on a sync after `SYNC_TIMEOUT_MS` and sends the same
 * `clientEventId`s again on the next pass, while the request it gave up on may
 * still be running here. Each writer asks "is this id already recorded?" twice:
 * before any work, and again under its lock, after the first request has
 * committed or rolled back. Those two questions catch every overlap on one
 * subject. This catches what is left: a collision on the
 * `(shop_id, client_event_id)` unique index that neither question saw, which
 * would otherwise abort the transaction with 23505 and fail the whole batch.
 *
 * Only that one index, and only for an offline write that carried an id. Any
 * other error, or a collision whose row cannot then be read back, is thrown
 * as it was.
 */
export async function answeringReplayAsDuplicate<T>(
  write: () => Promise<T>,
  replay: {
    indexName: string;
    clientEventId: string | undefined;
    source: "live" | "offline" | undefined;
    applied: (clientEventId: string) => Promise<string | undefined>;
  },
): Promise<T | { ok: true; eventId: string; duplicate: true }> {
  try {
    return await write();
  } catch (error) {
    if (
      replay.source !== "offline" ||
      !replay.clientEventId ||
      !violatesUniqueIndex(error, replay.indexName)
    ) {
      throw error;
    }
    const eventId = await replay.applied(replay.clientEventId);
    if (!eventId) throw error;
    return { ok: true, eventId, duplicate: true };
  }
}
