/**
 * What counts as a capability URL, and how to strip the credential out of one.
 *
 * Lives in `src/lib` rather than beside the telemetry clients because it is
 * framework-free string logic with two consumers on opposite sides of the
 * layer boundary: the browser SDK wrappers in `src/app/observability.ts`
 * (which re-exports everything here, so every existing import still resolves),
 * and `src/lib/analytics-request-context.ts`, which redacts the page URL that
 * Vercel's *server* analytics composes for itself. `src/lib` may not import
 * `src/app` (`pnpm check:architecture`), and the two halves must agree on what
 * a capability URL is, so the definition belongs on this side.
 */
/**
 * Bearer-capability routes whose path segment after the prefix is a
 * replayable credential, never an identifier safe to leave in telemetry.
 *
 * Exported for `observability.test.ts`, which asserts this list against the
 * `src/app/<prefix>/[token]` directories actually on disk. Keeping the two in
 * agreement by review alone is what let `/unsubscribe/[token]` ship
 * unredacted — it was the tenth such route and had never been added here — so
 * the filesystem, not this array and not a prose list in a runbook, is the
 * source of truth a new capability route has to survive.
 */
export const CAPABILITY_ROUTE_PREFIXES = [
  "waivers",
  "ready",
  "recap",
  // Account-lifecycle tokens (20260725-account-lifecycle-emails):
  // /verify/[token] and /reset-password/[token]. /forgot-password carries no
  // token in its URL (the email is a POST body field), so it needs none of
  // this.
  "verify",
  "reset-password",
  // Staff-invite acceptance token (20260726-staff-invite-accounts).
  "invite",
  // Party seat-claim token (20260804-seat-claim-links): /claim/[token] lets
  // one party member take over one seat, so a leaked copy is a working
  // identity-takeover link for that seat until it is used or revoked.
  "claim",
  // Staff calendar-subscription feed token (ADR
  // 20260730-calendar-feed-subscriptions, owned by src/features/calendar-sync).
  // `/calendar/[token]` sits outside `/shop` so no session gate applies and the
  // URL *is* the capability — its own route handler says so verbatim. It is the
  // longest-lived credential of the set: a calendar client re-fetches the same
  // URL unattended for as long as the subscription exists, so one leaked copy
  // in telemetry replays the whole shop's schedule indefinitely.
  "calendar",
  // Email unsubscribe tokens (`last_minute_list_unsubscribe_tokens` and
  // `person_courtesy_email_unsubscribe_tokens`, both resolved by
  // /unsubscribe/[token]). Found missing by the OPS-L1 review: the tenth
  // capability route, and the only one this list had never covered. The
  // capability it grants is the narrowest of the set — stop these emails, and
  // the page reveals only a shop name — but neither table carries an
  // `expires_at` or a `revoked_at`, so an exposed token works forever, which
  // is a longer life than anything else here.
  "unsubscribe",
] as const;

/**
 * Query parameters that carry a bearer capability token directly, rather than
 * as a path segment — the schedule-confirmation page's `?booking=<token>`
 * (CR-002/CR-003's `confirm` capability, minted by `issueBookingCapability`
 * and threaded through `src/app/s/[shopSlug]/trips/[id]/actions.ts`,
 * including Stripe's checkout return URL). A security review of the original
 * CR-001 fix found this token reaching Analytics/Speed Insights unredacted —
 * the path-prefix check alone never inspects query parameters at all, and
 * `/s/[shopSlug]/trips/[id]` doesn't match any capability prefix. Same
 * "value is a replayable credential" reasoning as the path prefixes above,
 * checked independently of them so it still catches the token even on a path
 * that isn't itself capability-prefixed.
 */
const CAPABILITY_QUERY_PARAMS = [
  "booking",
  /**
   * `?gate=` is not a bearer token — the signature (`signTripAdmissionGate`,
   * src/lib/trip-admission-gate.ts) unlocks a *sentence*, not a resource, and
   * verification is bound to an id already in the path. It is redacted anyway,
   * for what the value says rather than what it opens: on the diver-record
   * refusal the URL is `/shop/<slug>/divers/<personId>?notice=trip-prerequisite
   * &gate=<requiredLevel>~<heldLevel>~<specialties>~<nitrox>.<hmac>` — a person
   * id sitting next to the certification level that person actually holds.
   * Forwarding that pair to Analytics and Sentry breadcrumbs is a data-
   * minimisation failure whatever the signature does, and the redaction costs
   * nothing (found by the security review of the 2026-08-15 `noticeUrl` change,
   * which routed this param through a shared builder and so made it worth
   * asking where it ends up).
   */
  "gate",
] as const;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Rewrites any `CAPABILITY_ROUTE_PREFIXES` path — `/waivers/<token>`,
 * `/ready/<token>`, `/recap/<token>`, `/verify/<token>`,
 * `/reset-password/<token>`, `/invite/<token>`, `/claim/<token>`,
 * `/calendar/<token>`, `/unsubscribe/<token>` (and any
 * URL-encoded variant of those prefixes) — to its template form, and
 * redacts any `CAPABILITY_QUERY_PARAMS` value on *any* path, so
 * Analytics/Speed Insights never receive a raw capability regardless of
 * whether it travels as a path segment or a query parameter. Fails closed on
 * an unparseable URL — better to drop a URL we can't inspect than risk
 * forwarding a token we failed to recognize.
 */
export function redactCapabilityUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl, "https://redact.invalid");
  } catch {
    return "[unparseable]";
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments.length >= 2 ? decodeSegment(segments[0] ?? "").toLowerCase() : "";
  const prefix = CAPABILITY_ROUTE_PREFIXES.find((candidate) => candidate === first);
  if (prefix) return `/${prefix}/[token]`;

  let redactedQuery = false;
  for (const param of CAPABILITY_QUERY_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.set(param, "[token]");
      redactedQuery = true;
    }
  }
  return redactedQuery ? `${url.pathname}${url.search}` : rawUrl;
}
