import webpush from "web-push";

/**
 * Web Push transport for the manifest's third refresh trigger (ADR
 * 20260804-manifest-web-push) — the one that reaches a phone whose page is
 * frozen, which neither the SSE stream nor the interval can.
 *
 * Deliberately thin and provider-shaped like the SES/SNS adapters beside it:
 * it knows how to sign and post one message and how to classify the outcome,
 * and nothing about trips, roll call, or when a push is warranted. The
 * decision to send lives in `src/db/push-subscriptions.ts`; the words live in
 * the caller's message bundle. Nothing here returns a sentence a user reads.
 */

/** The device credential a push is addressed to. Never logged, never returned to a client. */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * `gone` is the outcome that matters operationally: the push service reports a
 * retired endpoint as 404/410, and that subscription must be deleted rather
 * than retried forever. `failed` is everything else — transient or not, the
 * caller's response is the same (leave the row, it is best-effort), so they are
 * not split further.
 */
export type WebPushResult = { status: "sent" } | { status: "gone" } | { status: "failed" };

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  /** VAPID contact, a `mailto:` or `https:` URL the push service can reach us at. */
  subject: string;
}

/**
 * Read once per call rather than at module load: a missing key must degrade to
 * "push is off", not throw at import time and take down every route that
 * transitively imports this. Returns null when unconfigured, which every caller
 * treats as "no push configured" and moves on.
 */
export function webPushConfig(env: NodeJS.ProcessEnv = process.env): WebPushConfig | null {
  // Honoured here rather than assumed elsewhere: the e2e fleet sets fixture
  // VAPID keys so the opt-in control renders, and without this check a suite
  // that ever obtained a real subscription would make live outbound POSTs to a
  // vendor push service, signed with a keypair that is committed to this repo.
  if (env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1") return null;
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Ten minutes: past that, a roll-call change is stale enough not to be worth waking a phone for. */
export const WEB_PUSH_TTL_SECONDS = 600;

/**
 * Hard ceiling on one send.
 *
 * The `web-push` library issues a bare `https.request` with no timeout of its
 * own, so without this a push service that accepts a connection and then never
 * answers hangs this call indefinitely. That matters more here than it looks:
 * the fan-out is awaited inside `publishManifestEvent`, which is awaited by
 * `recordRollCall` — so an un-timed send does not merely delay a notification,
 * it blocks a captain's "Boarded" tap. Catching exceptions protects against a
 * send that *throws*; only a timeout protects against one that hangs.
 */
export const WEB_PUSH_TIMEOUT_MS = 5_000;

/** Resolves to `onTimeout` if `work` has not settled within `ms`, without leaving a live timer. */
async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The push services a subscription endpoint may name.
 *
 * This is a security boundary, not tidiness. The endpoint arrives from the
 * browser and the server later POSTs to it, so an unvalidated value turns this
 * feature into a server-side request forgery primitive: anyone who can reach
 * the opt-in action could have DiveDay's backend POST encrypted bodies at a URL
 * of their choosing, including internal addresses. A protocol check alone does
 * not fix that — `https://10.0.0.1/` passes it.
 *
 * The real set is small, stable, and vendor-published, so an allowlist is
 * affordable here in a way it usually isn't. A browser shipping a push service
 * not on this list degrades to "push unavailable", which is the safe direction:
 * the SSE stream and the interval still refresh the manifest.
 */
const ALLOWED_PUSH_HOSTS = [
  // Chrome / Chromium, and anything else on Google's FCM.
  "fcm.googleapis.com",
  "android.googleapis.com",
  // Firefox.
  "updates.push.services.mozilla.com",
  // Safari, macOS and iOS.
  "web.push.apple.com",
  // Edge / Windows.
  "notify.windows.com",
] as const;

/** Cap before parsing: a URL is a string from the network, and these run ~200 chars. */
const MAX_ENDPOINT_LENGTH = 2048;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Exact host, or a subdomain of one — `notify.windows.com` is regionalised as
  // `<region>.notify.windows.com`. Anchored on a leading dot so a lookalike
  // host such as `evilnotify.windows.com.attacker.test` cannot match.
  return ALLOWED_PUSH_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
}

/**
 * The public key to hand a browser, or null if this deploy cannot actually
 * push.
 *
 * Deliberately requires all three variables even though only the public one is
 * returned: gating the opt-in control on `VAPID_PUBLIC_KEY` alone would let a
 * half-configured deploy collect device credentials it can never send to, which
 * is a table of useless secrets and a control that lies. Unlike `webPushConfig`
 * this ignores `DIVEDAY_DISABLE_EXTERNAL_HTTP`, so the e2e fleet still renders
 * the control (and its visual capture) while every send stays blocked.
 */
export function webPushPublicKey(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return env.VAPID_PUBLIC_KEY;
}

/** Injectable for tests — the real one posts to a third-party push service. */
export type SendNotification = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : null;
}

/**
 * Send one push. Never throws: a failure here must not fail the roll-call write
 * that triggered it (ADR 20260804-manifest-web-push — the fan-out is
 * best-effort by design).
 *
 * `ttl` is deliberately short. A manifest push is only worth delivering while
 * it is still current; a notification the push service held for hours and
 * delivers after the boat is back is noise at best and misleading at worst.
 */
export async function sendWebPush(
  target: WebPushTarget,
  payload: unknown,
  config: WebPushConfig,
  send: SendNotification = webpush.sendNotification,
): Promise<WebPushResult> {
  // Re-checked here, not only where the row was written. The allowlist is a
  // security boundary, and a boundary enforced solely at one call site stops
  // holding the moment anything else writes a row — an import, a restored
  // backup, a seed, a future admin path — or the moment the list is narrowed
  // and stored endpoints outlive it. `src/db` must not have to trust that
  // `src/app` checked.
  if (!isAllowedPushEndpoint(target.endpoint)) return { status: "failed" };
  try {
    const sent = send(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        TTL: WEB_PUSH_TTL_SECONDS,
      },
    );
    // A timeout is reported as `failed`, never `gone`: a slow push service must
    // not cost a captain their subscription.
    const timedOut = Symbol("timed-out");
    const outcome = await withTimeout<unknown>(sent, WEB_PUSH_TIMEOUT_MS, timedOut);
    if (outcome === timedOut) return { status: "failed" };
    return { status: "sent" };
  } catch (error) {
    const status = statusOf(error);
    // 404/410 is the push service saying this endpoint is retired — the device
    // uninstalled, cleared data, or the browser rotated it. Anything else is
    // left alone, since a transient 5xx must not delete a live subscription.
    if (status === 404 || status === 410) return { status: "gone" };
    return { status: "failed" };
  }
}
