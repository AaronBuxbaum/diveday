import { log } from "@/lib/log";
import { violatesUniqueIndex } from "./query-helpers";

/**
 * A device sent an offline event under a `clientEventId` this shop already
 * holds for a *different* subject (another seat, another crew member, another
 * checklist line, another departure). Only a device bug gets here: ids are
 * `crypto.randomUUID()`. Answering `duplicate` would let the device mark its
 * tap applied when nothing about that subject was written, the quiet
 * direction on a missing-diver mark, so it is refused out loud instead
 * (layer 1 re-review, N9).
 */
export const CLIENT_EVENT_CONFLICT = "client_event_conflict";

/** What an event already on the record under a device's id says it is about. */
export type StoredOfflineEvent = { id: string; subject: string };

export type ReplayVerdict =
  | { ok: true; eventId: string; duplicate: true }
  | { ok: false; reason: typeof CLIENT_EVENT_CONFLICT };

/**
 * The answer to an offline event whose id is already recorded: a duplicate
 * when the stored row is about the same subject, a conflict when it is not.
 * Undefined when nothing is stored under the id. `subject` is compared
 * exactly; each writer builds it the same way for the stored row and the
 * replay (trip and seat, trip and person, trip and checklist line).
 */
export function replayVerdict(
  stored: StoredOfflineEvent | undefined,
  subject: string,
  table: string,
): ReplayVerdict | undefined {
  if (!stored) return undefined;
  if (stored.subject === subject) return { ok: true, eventId: stored.id, duplicate: true };
  // Codes only: no ids or names in the line (the no-PII logging rule).
  log("offline_sync.client_event_conflict", "warn", { table });
  return { ok: false, reason: CLIENT_EVENT_CONFLICT };
}

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
 * The stored row is then judged as the two questions judge it
 * ({@link replayVerdict}): same subject, a duplicate; another, a conflict.
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
    subject: string;
    stored: (clientEventId: string) => Promise<StoredOfflineEvent | undefined>;
  },
): Promise<T | ReplayVerdict> {
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
    const verdict = replayVerdict(
      await replay.stored(replay.clientEventId),
      replay.subject,
      replay.indexName,
    );
    if (!verdict) throw error;
    return verdict;
  }
}
