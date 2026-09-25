# 20260925-shops-are-set-up-by-hand — Shut self-serve sign-up; open `/onboard` only with a setup key

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

Until now any visitor could create a real shop and owner login at `/onboard`, and the homepage
led there through a "Try it with your boats" hero (ADR 20260908-one-hand, decision 6, possibility
Y). The owner decided on 2026-09-25 that, for now, every shop is set up by the owner directly and a
prospective shop reaches out to get set up instead. `/onboard`'s action is still the only code
that creates a real shop, its owner and their login ([20260726-staff-invite-accounts](20260726-staff-invite-accounts.md)),
so the question is how to keep that one path working for the owner while shutting it for
everyone else.

## Decision

- **One key opens the door.** `ONBOARD_SETUP_KEY` (a `manual`, Vercel-only row in
  `config/env-registry.mjs`) is a long random string. `/onboard?setup=<key>` renders the unchanged form, which posts the key
  back as a hidden field; `onboardAction` checks it again before any database handle is taken,
  because a server action can be called without its page. Checked by `isOnboardSetupKey`
  (`src/lib/onboard-setup-key.ts`) as a constant-time digest comparison. A bounce back to the form
  echoes the key only after it has matched.
- **Closed unless configured.** In production an unset key, one shorter than 24 characters, or one
  of the two keys written in this repository means no shop can be created by anyone. Outside production a fixed key keeps `pnpm dev`
  zero-setup; the e2e fleet pins its own (`E2E_ONBOARD_SETUP_KEY`, `e2e/servers.ts`).
- **Without the key, `/onboard` says where to write.** One sentence and a mail to
  `onboarding@dive.day` (`ONBOARDING_EMAIL`, `src/lib/platform-mail.ts`). The page is `noindex` and
  out of the sitemap. `?setup=` is a capability query parameter, redacted from telemetry
  (`src/lib/capability-urls.ts`).
- **Every public "Start a trial" becomes "Get set up"**: the second door beside the demo in
  `FunnelCtas`, and sign-in's "Need a shop?" line, are a `mailto:` to the same inbox with the
  subject written. The switching guides' signed-out import door is removed, since the concierge band
  on the same page already offers a person. The demo still leads.
- **The try-it hero is removed.** `TryItHero`, its colour suggestion and its handoff are deleted;
  the form keeps its optional boat and first departure (`src/lib/first-day.ts`,
  `src/db/first-day.ts`). The `home-drawn` funnel tag is retired.

The trial itself is unchanged: a shop's three weeks still start at `shops.created_at`, whoever
filled in the form.

## Alternatives considered

- **A CLI script against the production database** — needs production credentials on a laptop and
  a second shop-creation path to keep in step with the action; the form already is that path.
- **An operator allowlist on a signed-in account** — DiveDay has no platform-operator identity, and
  inventing one is a larger security surface than one shared secret.
- **A contact form** — a new surface with its own rate limit, spam and storage, for what a mail
  already does.

## Consequences

The owner opens a shop by visiting the setup link and filling the form in themselves. **The link is a
standing credential**: shared, reusable and unexpiring, so anyone holding it — a forwarded mail,
browser history, anyone who can read Vercel's request logs — can create shops until the key is
rotated. Changing `ONBOARD_SETUP_KEY` revokes every copy at once; the five-an-hour rate limit is per
IP, not a cap. So the link is not sent to a shop. If shops should ever fill the form in themselves,
the shape is a per-invite token (hashed, expiring, spent in the same transaction as the shop
insert, like `src/db/account-tokens.ts`), not this key. The page sets `referrer: no-referrer`, and
Sentry's query string is redacted with the URL, so the key does not travel on from it.
Funnel attribution for the second door is gone, because a mail carries no tag; `trial_started`
still fires, with `source` from any `?from=` the owner adds to the link.

Revisit when shops should sign themselves up again. Reopening is deleting the key check and
pointing `FunnelCtas` back at `/onboard`; nothing about the data model changed.
