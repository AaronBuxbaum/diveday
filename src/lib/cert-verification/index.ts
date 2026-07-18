import { z } from "zod";

/**
 * The certification-verification seam: check a C-card against the issuing
 * agency's records. Like the notification and storage seams, the provider sits
 * behind one entry point so the review flow stays testable without a live
 * agency integration (ADR 20260718-agency-cert-verification).
 *
 * Safety posture: this is *assistive*. A confirmed match is strong enough
 * evidence to verify a card; anything else — not found, a mismatch, or an
 * unavailable provider — never clears a card on its own. It fails closed to
 * `unavailable`, leaving the card pending for a human.
 */
export type CertVerificationResult =
  | { status: "verified"; reference?: string }
  | { status: "not_found" }
  | { status: "mismatch" }
  | { status: "unavailable" };

export type CertVerificationRequest = {
  agency: string;
  level?: string;
  identifier: string;
  holderName?: string;
};

export interface CertVerificationProvider {
  verify(request: CertVerificationRequest): Promise<CertVerificationResult>;
}

type Fetch = typeof fetch;
type VerificationEnvironment = Readonly<Record<string, string | undefined>>;

const configSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().trim().min(1),
});

const responseSchema = z.object({
  status: z.enum(["verified", "not_found", "mismatch"]),
  reference: z.string().max(200).optional(),
});

/** Generic agency-verification gateway: one POST, a typed status back. */
export function httpCertVerificationProvider(
  config: { url: string; apiKey: string },
  fetchImpl: Fetch,
): CertVerificationProvider {
  return {
    async verify(request) {
      try {
        const response = await fetchImpl(config.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        });
        if (!response.ok) return { status: "unavailable" };
        const body = responseSchema.safeParse(await response.json());
        if (!body.success) return { status: "unavailable" };
        return body.data.status === "verified"
          ? { status: "verified", reference: body.data.reference }
          : { status: body.data.status };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

const disabledCertVerificationProvider: CertVerificationProvider = {
  async verify() {
    return { status: "unavailable" };
  },
};

export function certVerificationProviderFromEnvironment(
  env: VerificationEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): CertVerificationProvider {
  const config = configSchema.safeParse({
    url: env.CERT_VERIFICATION_URL,
    apiKey: env.CERT_VERIFICATION_API_KEY,
  });
  return config.success
    ? httpCertVerificationProvider(config.data, fetchImpl)
    : disabledCertVerificationProvider;
}

export function verifyCard(
  request: CertVerificationRequest,
  provider: CertVerificationProvider = certVerificationProviderFromEnvironment(),
): Promise<CertVerificationResult> {
  return provider.verify(request);
}
