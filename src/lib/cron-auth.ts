import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The one gate every `/api/cron/*` route opens with.
 *
 * Vercel Cron calls each route with `Authorization: Bearer <CRON_SECRET>`.
 * Eleven routes used to check that with a copy-pasted `!==`, which is two
 * problems: a string comparison returns as soon as one byte differs, so its
 * timing says how much of a guess was right, and eleven copies are eleven
 * places for the fail-closed half to be dropped.
 *
 * Fails closed: with no `CRON_SECRET` configured the answer is 503
 * `{ error: "not_configured" }` -- unavailable, never open -- so a deployment
 * that forgot the secret cannot have its sends, prunes or backups triggered
 * by anyone. A missing or wrong token is a bodiless 401.
 *
 * Both sides are hashed before `timingSafeEqual`, which needs equal-length
 * buffers: comparing two SHA-256 digests is constant-time in the secret's
 * content *and* its length, where a bare length check first would answer
 * "how long is the secret" in one probe.
 *
 * Returns the refusal to send, or `null` when the caller may proceed. Each
 * route calls this *before* its Sentry check-in, so an unauthorized probe can
 * never tell the monitor that a tick happened. A plain `Response`, not
 * `NextResponse`, because `src/lib` stays framework-free; a route handler may
 * return either.
 */
export function requireCronSecret(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
): Response | null {
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const presented = request.headers.get("authorization") ?? "";
  return sameSecret(presented, `Bearer ${secret}`) ? null : new Response(null, { status: 401 });
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function sameSecret(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}
