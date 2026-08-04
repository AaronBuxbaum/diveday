import { getDb } from "@/db/client";
import { subscribeManifestEvents } from "@/db/manifest-events";
import { getTripWithBooked } from "@/db/trips";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";

// Node runtime, not Edge: the shared LISTEN client (src/db/manifest-events.ts)
// needs the `pg` driver. See ADR 20260726-manifest-push-refresh. Cache
// Components requires the Node.js runtime for every route (edge is no
// longer an option), so the explicit `runtime` export is now redundant and
// incompatible with `nextConfig.cacheComponents` — removed, not relaxed.

/**
 * Declared, not inherited. Every other long-running route here states its own
 * budget (the crons, the health probe); this one streams, so leaving it to the
 * platform default meant the cutoff that ends each stream was whatever Vercel
 * happened to be defaulting to — invisible in the code, and free to move under
 * us on a plan or platform change.
 */
export const maxDuration = 300;

/**
 * How long a single stream lives before this route retires it deliberately.
 *
 * This stream has no natural end: the heartbeat below guarantees it is never
 * idle, and a manifest page left open on a boat tablet is the case the whole
 * feature exists for. So the only thing that ever ended one was the platform
 * killing the invocation at `maxDuration` — which is a runtime timeout, logged
 * as an error, on every long-lived viewer. The reconnect was always the design
 * (see ADR 20260726-manifest-push-refresh); being *killed* to trigger it was
 * not. Ending the stream ourselves, well inside the budget, turns a subscriber
 * into a sequence of clean reconnects instead of a sequence of timeouts.
 *
 * The margin below `maxDuration` covers the auth/trip lookup that already ran
 * before this timer started, plus whatever the platform charges for cold start
 * and teardown — generous on purpose, since overshooting it costs the exact
 * error this exists to bound, while a wider margin costs only a slightly
 * shorter stream, which is a reconnect the client already handles.
 */
const STREAM_TTL_MS = 240_000;
const HEARTBEAT_MS = 25_000;

/**
 * Sent once at stream open, which is what makes the retirement above cheap:
 * `EventSource` applies this to *every* subsequent reconnect, so a retired
 * stream is replaced in about two seconds instead of the browser's default
 * three. The gap is still a gap — a change published inside it reaches this
 * device only via the manager's own poll/visibility fallback, unchanged and
 * still the designated backstop.
 */
const RETRY_MS = 2_000;

/**
 * Push "this trip's roll call changed" to the offline manifest manager, so it
 * refreshes without waiting for its interval. Staff-session-gated the same
 * way the manifest page itself is, plus the same shop-ownership check
 * `getTripWithBooked` enforces elsewhere — a stream can never observe a trip
 * outside the caller's own shop.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const { id: tripId } = await params;
  const db = await getDb();
  const trip = await getTripWithBooked(db, session.user.shopId, tripId);
  if (!trip) return Response.json({ error: "not_found" }, { status: 404 });

  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Every write goes through here rather than enqueueing directly: a write
      // onto an already-closed controller throws, and for the subscription
      // callback that throw lands inside the shared dispatch loop every other
      // subscriber in this process rides on (see the cancel() note below).
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Nothing left to write to — retire this subscriber rather than
          // letting the next heartbeat or notification try again.
          stop();
        }
      };
      const unsubscribe = subscribeManifestEvents(session.user.shopId, tripId, () => {
        send("event: manifest-changed\ndata: {}\n\n");
      });
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      // Wrapped, not passed as `stop` directly: `stop` is still the no-op
      // placeholder at this line and is reassigned below.
      const retirement = setTimeout(() => stop(), STREAM_TTL_MS);
      stop = () => {
        clearInterval(heartbeat);
        clearTimeout(retirement);
        unsubscribe();
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // Already closed (by the client disconnecting first, or by this
          // same stop() running twice — abort, cancel and the retirement
          // timer can all fire) — fine.
        }
      };
      // The client can disconnect while auth()/getDb()/the trip lookup above
      // were still awaiting, aborting request.signal before this callback
      // ever runs — an abort listener registered after the fact never
      // replays it, which would otherwise leak this subscription and
      // heartbeat interval for the rest of the warm process's life.
      if (request.signal.aborted) {
        stop();
        return;
      }
      request.signal.addEventListener("abort", stop);
      // First bytes, sent immediately rather than waiting up to a heartbeat:
      // it flushes the response through any buffering proxy so the client's
      // `EventSource` reaches its open state now, and it carries the reconnect
      // delay the retirement above depends on.
      send(`retry: ${RETRY_MS}\n\n`);
    },
    // A consumer can cancel the stream directly (reader.cancel(), or a
    // downstream adapter) without request.signal itself ever aborting —
    // start()'s abort listener alone misses that. Without this hook the
    // subscription and heartbeat stay alive indefinitely, and the next
    // notification/heartbeat throws enqueuing onto an already-cancelled
    // controller.
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
