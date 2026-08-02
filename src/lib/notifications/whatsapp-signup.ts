import { randomInt } from "node:crypto";
import { z } from "zod";
import { log } from "@/lib/log";
import { GRAPH_API_ORIGIN, GRAPH_API_VERSION } from "./whatsapp";

/**
 * Meta **Embedded Signup**: the onboarding half of the WhatsApp channel (docs
 * ADR 20260802-whatsapp-embedded-signup, superseding the paste-your-own-
 * credentials flow in 20260802-whatsapp-cloud-api-per-shop).
 *
 * The shop clicks one button, completes Meta's own hosted flow in a popup, and
 * comes back connected. Everything below is what happens *after* that popup
 * closes: the browser hands back an authorization code plus the ids of the
 * WhatsApp Business Account (WABA) and phone number the shop just picked, and
 * the server turns that into a working sender.
 *
 * Four server-to-server steps, in this order, because each depends on the last:
 *
 * 1. **Exchange** the code for a business token scoped to that shop's WABA.
 * 2. **Register** the phone number for Cloud API use — until this, the number
 *    exists but cannot send.
 * 3. **Subscribe** DiveDay's app to the WABA, which is what makes delivery
 *    webhooks arrive at all.
 * 4. **Provision the template** on the shop's own WABA, so DiveDay submits it
 *    for review on their behalf instead of walking them through Meta's UI.
 *
 * Step 3 is the one worth understanding: Meta delivers webhooks per *Meta app*,
 * signed with that app's secret. Because Embedded Signup subscribes every
 * shop's WABA to **DiveDay's single app**, all delivery statuses land on one
 * endpoint under one secret — which is precisely what the paste-your-own-
 * credentials flow made impossible, and why the delivery webhook could only be
 * built once onboarding moved here.
 *
 * Returns codes, never sentences; the UI picks the words (ADR
 * 20260731-domain-layer-copy-leaks).
 */

export type WhatsAppSignupConfig = {
  /** DiveDay's Meta app id — public, and also used by the browser to launch the flow. */
  appId: string;
  /** DiveDay's Meta app secret. Server-only; it is what signs the token exchange. */
  appSecret: string;
  /** The Embedded Signup configuration id created in Meta's dashboard. */
  configId: string;
};

const signupConfigSchema = z.object({
  appId: z.string().trim().min(1),
  appSecret: z.string().trim().min(1),
  configId: z.string().trim().min(1),
});

/**
 * DiveDay's Meta app credentials, or null when this deployment has none.
 *
 * Null is the expected state until Meta approves the app: Embedded Signup
 * requires app review and business verification, so the connect button stays
 * unavailable rather than launching a flow that would fail at Meta's end.
 */
export function whatsAppSignupConfigFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppSignupConfig | null {
  const parsed = signupConfigSchema.safeParse({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    configId: env.META_WHATSAPP_SIGNUP_CONFIG_ID,
  });
  return parsed.success ? parsed.data : null;
}

/** Which of the four steps failed, so the UI can say something more useful than "it broke". */
export type SignupStep = "exchange" | "register" | "subscribe" | "template";

export type WhatsAppSignupResult =
  | {
      status: "completed";
      accessToken: string;
      /** Whether the template already existed — a reconnect, not a first connect. */
      templateAlreadyExisted: boolean;
    }
  | {
      status: "failed";
      step: SignupStep;
      httpStatus?: number;
      errorCode?: string;
      detail?: string;
    };

export type CompleteSignupInput = {
  /** The one-time authorization code Meta's popup returned. */
  code: string;
  wabaId: string;
  phoneNumberId: string;
  /** Names the template DiveDay provisions on the shop's WABA. */
  templateName: string;
  templateLanguage: string;
  /** The body text and reviewer examples for the template being provisioned. */
  templateCopy: CourtesyTemplateCopy;
  /**
   * The six-digit PIN to register this number with, or **null to skip
   * registration entirely** because this number is already registered.
   *
   * Null is the reconnect case, and it matters. Meta's two-step verification
   * binds a number to the PIN it was first registered with, so calling
   * `register` again with a *fresh* PIN does not re-register it — it fails with
   * 133005 (PIN mismatch) and counts against a lockout limit (133008). A number
   * DiveDay has a stored row for was registered successfully once already;
   * there is nothing to redo, and the safest thing to send is no PIN at all.
   */
  registrationPin: string | null;
};

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });
const successResponseSchema = z.object({ success: z.boolean() });

type GraphFailure = {
  httpStatus?: number;
  errorCode?: string;
  detail?: string;
  /** Meta's numeric code and subcode, kept structured so decisions compare exactly. */
  code?: number;
  subcode?: number;
};

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const graphErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
  }),
});

function graphFailure(status: number, rawBody: string): GraphFailure {
  const parsed = graphErrorSchema.safeParse(safeJson(rawBody));
  const error = parsed.success ? parsed.data.error : undefined;
  const code = error?.code;
  const subcode = error?.error_subcode;
  return {
    httpStatus: status,
    errorCode:
      code === undefined ? undefined : subcode === undefined ? `${code}` : `${code}/${subcode}`,
    detail: error?.message?.slice(0, 500),
    code,
    subcode,
  };
}

type GraphCall = { ok: true; body: unknown } | ({ ok: false } & GraphFailure);

async function graphRequest(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<GraphCall> {
  try {
    const response = await fetchImpl(url, init);
    const rawBody = await response.text();
    if (!response.ok) return { ok: false, ...graphFailure(response.status, rawBody) };
    return { ok: true, body: safeJson(rawBody) };
  } catch (error) {
    return {
      ok: false,
      errorCode: "network_error",
      detail: error instanceof Error ? error.message.slice(0, 500) : undefined,
    };
  }
}

function graphUrl(path: string): string {
  return `${GRAPH_API_ORIGIN}/${GRAPH_API_VERSION}/${path}`;
}

/**
 * A six-digit registration PIN. The shop never sees or types it — DiveDay
 * generates it, registers with it, and seals it.
 *
 * `randomInt` rather than `Math.random`: this value is a credential, sealed at
 * rest for the same reason the token is, and V8's PRNG state is recoverable
 * from a handful of observed outputs. Nothing on a live path depends on that
 * today, but a credential generated from a non-cryptographic source is not a
 * property worth having to reason about.
 */
export function generateRegistrationPin(randomSixDigits = () => randomInt(0, 1_000_000)): string {
  return String(randomSixDigits()).padStart(6, "0");
}

/**
 * The template body DiveDay submits on the shop's behalf, supplied by the
 * caller rather than written here.
 *
 * This text is what a *diver* eventually reads, so it belongs in the diver
 * message bundle like every other diver-facing string, resolved for the
 * template's own language (ADR 20260731-domain-layer-copy-leaks). This module
 * only knows its shape: exactly two variables, shop name then message.
 */
export type CourtesyTemplateCopy = {
  /** Must contain `{{1}}` and `{{2}}`, in that order. */
  body: string;
  /** Sample values Meta's reviewer sees in place of the two variables. */
  exampleShopName: string;
  exampleMessage: string;
};

/**
 * The template definition Meta's create endpoint expects.
 *
 * `example` is mandatory on create — Meta rejects a template whose variables
 * have no sample values, because a human reviewer has to see what the message
 * will actually look like.
 */
export function courtesyTemplateDefinition(
  name: string,
  language: string,
  copy: CourtesyTemplateCopy,
) {
  return {
    name,
    language,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: copy.body,
        example: { body_text: [[copy.exampleShopName, copy.exampleMessage]] },
      },
    ],
  };
}

/**
 * Turn a finished Embedded Signup popup into a working sender.
 *
 * Not transactional, and cannot be: these are four calls to someone else's API.
 * The order is chosen so a partial failure leaves the least-bad state — a token
 * that was exchanged but never registered simply doesn't send, whereas
 * subscribing webhooks for a number that can't send would produce events for
 * messages that never existed. A failed step is reported with the step name so
 * a retry (the shop pressing Connect again) can be reasoned about.
 */
export async function completeEmbeddedSignup(
  input: CompleteSignupInput,
  config: WhatsAppSignupConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppSignupResult> {
  // 1. Code → business token. Meta wants these as query parameters on a GET,
  //    unlike every other call here.
  const exchangeUrl = new URL(graphUrl("oauth/access_token"));
  exchangeUrl.searchParams.set("client_id", config.appId);
  exchangeUrl.searchParams.set("client_secret", config.appSecret);
  exchangeUrl.searchParams.set("code", input.code);
  const exchanged = await graphRequest(fetchImpl, exchangeUrl.toString(), { method: "GET" });
  if (!exchanged.ok) return failed("exchange", exchanged);
  const token = tokenResponseSchema.safeParse(exchanged.body);
  if (!token.success) return { status: "failed", step: "exchange", errorCode: "invalid_response" };
  const accessToken = token.data.access_token;

  const authorized = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // 2. Register the number for Cloud API use. Until this succeeds the number is
  //    connected but mute. Skipped entirely on a reconnect — see
  //    `registrationPin` above for why re-registering is actively harmful.
  if (input.registrationPin !== null) {
    const registered = await graphRequest(
      fetchImpl,
      graphUrl(`${encodeURIComponent(input.phoneNumberId)}/register`),
      {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ messaging_product: "whatsapp", pin: input.registrationPin }),
      },
    );
    // No swallowed failures here. A 133005 means someone else set a PIN on this
    // number — precisely the thing staff need told about, not routed around.
    if (!registered.ok) return failed("register", registered);
  }

  // 3. Subscribe DiveDay's app to this WABA — the step that makes delivery
  //    webhooks arrive at all (src/app/api/webhooks/whatsapp).
  const subscribed = await graphRequest(
    fetchImpl,
    graphUrl(`${encodeURIComponent(input.wabaId)}/subscribed_apps`),
    { method: "POST", headers: authorized },
  );
  if (!subscribed.ok) return failed("subscribe", subscribed);
  const subscribeBody = successResponseSchema.safeParse(subscribed.body);
  if (subscribeBody.success && !subscribeBody.data.success) {
    return { status: "failed", step: "subscribe", errorCode: "not_subscribed" };
  }

  // 4. Provision the courtesy template on the shop's own WABA. This is the
  //    whole reason Embedded Signup is worth the app review: the shop never has
  //    to author or submit a template themselves.
  const template = await graphRequest(
    fetchImpl,
    graphUrl(`${encodeURIComponent(input.wabaId)}/message_templates`),
    {
      method: "POST",
      headers: authorized,
      body: JSON.stringify(
        courtesyTemplateDefinition(input.templateName, input.templateLanguage, input.templateCopy),
      ),
    },
  );
  // 2388023 is "a template with this name and language already exists" — the
  // expected outcome of reconnecting, and success as far as this flow cares.
  // Compared as a number, not a substring: `includes("2388023")` also matches
  // 12388023 and 23880231, and this decision is whether to swallow a failure.
  const templateAlreadyExisted = !template.ok && template.subcode === 2_388_023;
  if (!template.ok && !templateAlreadyExisted) return failed("template", template);

  return { status: "completed", accessToken, templateAlreadyExisted };
}

function failed(step: SignupStep, failure: GraphFailure): WhatsAppSignupResult {
  log("notification.whatsapp_signup_failed", "warn", {
    step,
    httpStatus: failure.httpStatus,
    errorCode: failure.errorCode,
  });
  return { status: "failed", step, ...failure };
}
