import { configuredValue } from "@/lib/configured";
import { inboundReplyAddress } from "@/lib/inbox";
import type { NotificationEnvironment } from "./provider";

/**
 * Where a diver's reply is addressed (ADR 20260907-two-way-inbox).
 *
 * The receiving subdomain sits *under* the verified sending identity —
 * `inbound.ses.dive.day` under `ses.dive.day` — because SES receives for a
 * verified domain and every subdomain of it, so no second identity, no second
 * DKIM set, and the MX record is the only DNS the inbound path needs. A value
 * the repository already knows, compiled in beside the code that reads it
 * (`src/lib/configured.ts`); `EMAIL_INBOUND_DOMAIN` survives only as an
 * override for a fork or a self-hosted instance, and set *empty* it switches
 * the reply-to address off — every shop's mail then goes out with the
 * confirmed front-desk `Reply-To` it carried before, and nothing routes back.
 */
export const DEFAULT_INBOUND_EMAIL_DOMAIN = "inbound.ses.dive.day";

/** The receiving domain, or undefined when inbound mail is switched off. */
export function inboundEmailDomain(env: NotificationEnvironment = process.env): string | undefined {
  return configuredValue(env.EMAIL_INBOUND_DOMAIN, DEFAULT_INBOUND_EMAIL_DOMAIN)?.toLowerCase();
}

/** `reply+<token>@<domain>` for one shop, or undefined when inbound mail is switched off. */
export function shopInboundReplyAddress(
  inboundEmailToken: string,
  env: NotificationEnvironment = process.env,
): string | undefined {
  const domain = inboundEmailDomain(env);
  return domain ? inboundReplyAddress(inboundEmailToken, domain) : undefined;
}
