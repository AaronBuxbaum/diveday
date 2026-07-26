import { getDb } from "@/db/client";
import { subscribeManifestEvents } from "@/db/manifest-events";
import { getTripWithBooked } from "@/db/trips";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";

// Node runtime, not Edge: the shared LISTEN client (src/db/manifest-events.ts)
// needs the `pg` driver. See ADR 20260726-manifest-push-refresh.
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;

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
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const unsubscribe = subscribeManifestEvents(session.user.shopId, tripId, () => {
        controller.enqueue(encoder.encode("event: manifest-changed\ndata: {}\n\n"));
      });
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, HEARTBEAT_MS);
      const stop = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting first — fine.
        }
      };
      request.signal.addEventListener("abort", stop);
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
