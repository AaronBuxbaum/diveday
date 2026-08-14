import { z } from "zod";
import { configuredValue } from "@/lib/configured";

/**
 * The Stripe Connect seam: let a shop authorize its own Standard Stripe
 * account (not a platform-controlled sub-account) and read back its status.
 * Fetch-based like the checkout seam in ./index.ts — no SDK dependency
 * (docs ADR 20260719-stripe-connect-orders). Once a shop completes OAuth, the
 * platform secret key can act on its behalf with a `Stripe-Account` header;
 * no per-shop credential needs to be stored beyond the returned account id.
 */

export type ConnectAccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** The account's own settlement currency (e.g. "usd", "eur"); "usd" when Stripe omits it. */
  defaultCurrency: string;
};

export type ConnectOAuthResult =
  | { status: "connected"; stripeAccountId: string }
  | { status: "not_configured" }
  | { status: "failed" };

export type AccountStatusResult =
  | { status: "ok"; account: ConnectAccountStatus }
  | { status: "not_configured" }
  | { status: "failed" };

export type DeauthorizeResult = { status: "ok" | "not_configured" | "failed" };

export interface StripeConnectProvider {
  /** Null when Connect isn't configured — callers should hide the connect button, not link to a dead redirect. */
  authorizeUrl(input: { redirectUri: string; state: string }): string | null;
  exchangeCode(code: string, redirectUri: string): Promise<ConnectOAuthResult>;
  retrieveAccountStatus(stripeAccountId: string): Promise<AccountStatusResult>;
  deauthorize(stripeAccountId: string): Promise<DeauthorizeResult>;
}

type Fetch = typeof fetch;
type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * DiveDay's Connect application, from the platform's own Stripe Connect OAuth
 * settings. Not a secret and not per-deployment -- it names the application a
 * shop is connecting *to* -- so it is compiled in rather than deployed as
 * configuration (see `src/lib/configured.ts`). `STRIPE_CONNECT_CLIENT_ID`
 * still overrides it, which is what a fork with its own Connect application
 * sets; the paired secret key stays an environment secret, so a fork that sets
 * only one of the two still gets `disabledConnectProvider` rather than a
 * mismatched pair.
 */
export const CONNECT_CLIENT_ID = "ca_UvlITl41g1jCgVxyi3vqYguVm8l2dliH";

/** The one OAuth callback registered with Stripe for every self-service shop. */
export const STRIPE_CONNECT_CALLBACK_PATH = "/api/stripe/connect/callback";
export const STRIPE_CONNECT_STATE_COOKIE = "stripe_connect_state";

/**
 * Builds the fixed OAuth callback URL from the configured public origin.
 * The authenticated staff session identifies the shop once Stripe returns.
 */
export function stripeConnectCallbackUrl(appHost: string): string {
  return `${appHost}${STRIPE_CONNECT_CALLBACK_PATH}`;
}

const connectConfigSchema = z.object({
  secretKey: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
});

const oauthTokenResponseSchema = z.object({ stripe_user_id: z.string().min(1) });
const accountResponseSchema = z.object({
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  details_submitted: z.boolean(),
  // Optional so a fixture or a future Stripe response missing the field
  // still parses — mapped to a "usd" fallback below rather than failing the
  // whole status lookup over one non-critical field.
  default_currency: z.string().optional(),
});

type ConnectConfig = z.infer<typeof connectConfigSchema>;

function authHeaders(secretKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

export function stripeConnectProvider(
  config: ConnectConfig,
  fetchImpl: Fetch,
): StripeConnectProvider {
  return {
    authorizeUrl({ redirectUri, state }) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        scope: "read_write",
        redirect_uri: redirectUri,
        state,
      });
      return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
    },

    async exchangeCode(code, redirectUri) {
      try {
        const response = await fetchImpl("https://connect.stripe.com/oauth/token", {
          method: "POST",
          headers: authHeaders(config.secretKey),
          body: new URLSearchParams({
            client_secret: config.secretKey,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }).toString(),
        });
        if (!response.ok) return { status: "failed" };
        const body = oauthTokenResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return { status: "connected", stripeAccountId: body.data.stripe_user_id };
      } catch {
        return { status: "failed" };
      }
    },

    async retrieveAccountStatus(stripeAccountId) {
      try {
        const response = await fetchImpl(
          `https://api.stripe.com/v1/accounts/${encodeURIComponent(stripeAccountId)}`,
          { headers: { Authorization: `Bearer ${config.secretKey}` } },
        );
        if (!response.ok) return { status: "failed" };
        const body = accountResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return {
          status: "ok",
          account: {
            chargesEnabled: body.data.charges_enabled,
            payoutsEnabled: body.data.payouts_enabled,
            detailsSubmitted: body.data.details_submitted,
            defaultCurrency: body.data.default_currency ?? "usd",
          },
        };
      } catch {
        return { status: "failed" };
      }
    },

    async deauthorize(stripeAccountId) {
      try {
        const response = await fetchImpl("https://connect.stripe.com/oauth/deauthorize", {
          method: "POST",
          headers: authHeaders(config.secretKey),
          body: new URLSearchParams({
            client_id: config.clientId,
            stripe_user_id: stripeAccountId,
          }).toString(),
        });
        return { status: response.ok ? "ok" : "failed" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

const disabledConnectProvider: StripeConnectProvider = {
  authorizeUrl: () => null,
  async exchangeCode() {
    return { status: "not_configured" };
  },
  async retrieveAccountStatus() {
    return { status: "not_configured" };
  },
  async deauthorize() {
    return { status: "not_configured" };
  },
};

export function connectProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): StripeConnectProvider {
  const config = connectConfigSchema.safeParse({
    secretKey: env.STRIPE_SECRET_KEY,
    clientId: configuredValue(env.STRIPE_CONNECT_CLIENT_ID, CONNECT_CLIENT_ID),
  });
  return config.success ? stripeConnectProvider(config.data, fetchImpl) : disabledConnectProvider;
}
