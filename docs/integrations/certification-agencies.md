# Agency certification verification

Scuba can assist staff in validating PADI, SSI, and NAUI C-cards. It is not an authority to
issue a certification, decide equivalency, or reject a card. A confirmed response changes a card
from pending to verified; `not_found`, `mismatch`, timeout, bad response, and no configuration all
leave it pending for a human.

## Research result — 2026-07-18

No public, supported developer API documentation for automated C-card verification was found for
PADI, SSI, or NAUI. This is a statement about the public material reviewed, not evidence that a
partner-only interface does not exist. Do not automate the agencies' web forms, mobile apps, or
authenticated professional portals: those are human-facing workflows, expose personal data, and
may change without notice.

| Agency | Public verification path | Where to request supported integration access | What to ask for |
| --- | --- | --- | --- |
| PADI | PADI exposes card and professional help through its authenticated ecosystem; its Help Center directs professional credential checks to Pro Chek. | [PADI Retailer and Resort business support](https://www.padi.com/padi-dive-centers/business-support) lists regional business contacts and PADI Pros access. | “We operate a dive shop and need a supported, server-to-server C-card verification integration. Do you offer a partner API, approved verification service, or referral program for PADI certification number + holder-name validation?” |
| SSI | SSI’s MySSI flow presents a diver’s digital cards; SSI says a Training Center can look up certification history and directs partners to its service centers. | [SSI Global Service Center contacts](https://www.divessi.com/en/join-ssi/highlights/contact) and the [SSI Center program](https://www.divessi.com/en/become_professional). | “Does SSI offer an authorized API or partner integration to confirm a diver’s certification status? If so, please send the API specification, authentication method, sandbox access, scopes, and data-processing requirements.” |
| NAUI | [Verify Diver Certification](https://www.naui.org/services/verify-diver-certification/) is a public human-facing form requiring first name, last name, and date of birth. | [NAUI Worldwide](https://www.naui.org/naui-worldwide/) or `nauihq@naui.org` / +1 813-628-6284. | “Is there a supported server-to-server diver-certification verification API for an operating dive shop? We will not scrape the public form. Please send partner enrollment, rate limits, allowed data fields, authentication, and test guidance.” |

The public sources support the available human flows: PADI’s business-support page provides the
regional PADI contact route; SSI documents digital cards and Center-assisted history lookup; and
NAUI’s lookup form asks for a diver’s name and date of birth. None publishes an API contract on
those pages.

## What Scuba is ready for

Each agency has a separate, server-only configuration pair:

```dotenv
PADI_CERT_VERIFICATION_URL=https://your-authorized-gateway.example/verify
PADI_CERT_VERIFICATION_API_KEY=replace-with-padi-or-gateway-secret

SSI_CERT_VERIFICATION_URL=https://your-authorized-gateway.example/verify
SSI_CERT_VERIFICATION_API_KEY=replace-with-ssi-or-gateway-secret

NAUI_CERT_VERIFICATION_URL=https://your-authorized-gateway.example/verify
NAUI_CERT_VERIFICATION_API_KEY=replace-with-naui-or-gateway-secret
```

Only configure an agency after its provider has supplied and authorized the endpoint. Scuba selects
the matching agency pair first, so an SSI secret is never sent with a PADI or NAUI lookup. The
legacy shared `CERT_VERIFICATION_URL` / `CERT_VERIFICATION_API_KEY` remains available when one
approved broker handles more than one agency.

The configured endpoint must be a server-side endpoint that accepts this request:

```json
{
  "agency": "padi",
  "level": "open_water",
  "identifier": "PADI-123",
  "holderName": "Ada Diver"
}
```

Scuba sends `POST`, JSON, and `Authorization: Bearer <agency API key>`. It expects one of:

```json
{ "status": "verified", "reference": "provider-correlation-id" }
{ "status": "not_found" }
{ "status": "mismatch" }
```

If an agency offers a different protocol (OAuth, mTLS, different fields, or a different response),
put a small server-side adapter in front of it. The adapter owns the agency-specific protocol and
returns the contract above; Scuba continues to have one stable, tested safety boundary.

## Credential setup checklist

1. Confirm the shop’s agency/partner membership and obtain written approval for the lookup use
   case. Capture the allowed purpose, regions, diver-consent requirement, retention period, rate
   limits, and escalation contact.
2. Obtain the API specification, a sandbox or approved test credential, production endpoint, auth
   method, scopes, token rotation/expiry rules, and a known valid test record. Do not use a real
   diver’s data for an unapproved test.
3. If the response is not already the contract above, deploy a server-only adapter. Keep provider
   credentials in that adapter; configure Scuba with the adapter URL and its own rotation-capable
   bearer secret.
4. Add the matching two variables to Vercel’s **Preview** environment, use the authorized test
   record from the Certifications page, and verify that a positive match records the provider
   reference. A miss must remain pending.
5. Add the same pair to **Production**, restrict its owner, document the rotation date, and run one
   approved post-deploy check. Keep manual card review available at all times.

## Non-negotiable operating rules

- Never put agency keys in `NEXT_PUBLIC_*`, a client component, source control, screenshots, or
  card-image metadata.
- Never use a credential from one agency to test another agency’s card.
- Never scrape or replay private requests from MySSI, the PADI app/Pro site, or NAUI’s public form.
- Treat `not_found` and `mismatch` as review signals, not denials. Agencies may have partial,
  delayed, or differently-normalized records.
- Do not enable automatic verification until the dive operations lead has approved the agency’s
  equivalency, expiry, specialty, and exception policy under H-10.
