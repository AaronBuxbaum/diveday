# FU-20260812-ad-pixels-would-bypass-capability-redaction — Decide how an ad conversion tag may ever be installed, before someone installs one the normal way

- **Status:** Open
- **Raised:** 2026-08-12 — assessing paid acquisition channels (`docs/product/assessments/paid-acquisition-assessment.md`); tracing what a Google Ads conversion tag would actually do to the bearer-token pages
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/observability-client.tsx`, `src/app/observability.ts`, `docs/engineering/capability-telemetry-runbook.md`, `docs/product/assessments/paid-acquisition-assessment.md`

## What I noticed

`src/app/observability-client.tsx` is the single mount point for every telemetry client, and its own
comment says why: so "the capability-route redaction (CR-001) can't be bypassed by adding a raw
`<Analytics />`, `<SpeedInsights />`, or RUM client elsewhere." Each SDK is wrapped —
`<Analytics beforeSend={...redactCapabilityUrl(event.url)} />` and the equivalents — because DiveDay
has pages where **the URL is the credential**: `/waivers/[token]`, `/ready/[token]`, `/recap/[token]`,
`/calendar/[token]`.

The standard installation instructions for every advertising platform are a `<script>` in the
document head. `gtag.js` sends `page_location` on every pageview by default. So does the Meta pixel.
A conversion tag installed the way Google's own setup wizard describes would ship live waiver and
readiness capability URLs — the ones attached to signed waivers and medical evidence — to Google or
Meta on every visit, bypassing a redaction seam that was deliberately built, deliberately
centralised, and deliberately commented as un-bypassable.

Nothing is broken today: there is no ad pixel in the tree, and the advertising assessment recommends
`$0` of ad spend until a design partner exists. The risk is specifically that the *next* session told
"turn on conversion tracking" will follow the platform's documentation, which is correct for every
normal site and wrong for this one. The guardrail exists in code but the reason lives in a comment
that a person adding a script tag to `layout.tsx` will never open.

Remarketing is the sharper version of the same problem and deserves its own line: retargeting an
audience built from people who visited `/waivers/[token]` means building an advertising audience out
of people who signed a medical form. That is a different and worse thing than leaking a URL.

## Why it isn't already done

The scope I was given was an assessment, and the honest answer is that the right fix depends on a
decision nobody has made yet: **whether DiveDay ever runs a conversion tag at all.** The assessment
recommends a `$120/month` capped Google Search campaign only once a design partner is live, and
`docs/product/marketing.md` already measures the two marketing conversions server-side through
`src/lib/analytics.ts` (`demo_entered`, `trial_started`) with email alerts — which is a genuinely
better instrument than a browser pixel and may make the whole question moot.

So this is a question, not a defect, and the options differ enough to matter:

- **Never install one.** Import conversions into Google Ads offline from the existing server-side
  events instead, or simply read attribution off the `?from=` funnel tags already in
  `src/lib/funnel.ts`. Cheapest, safest, and probably right at 4–12 clicks a month.
- **Install one, but only through `Observability`,** wrapped the same way the existing SDKs are, with
  the redaction applied and the bearer-token segments excluded outright rather than redacted.
- **Install one the normal way.** Should be refused, and the refusal is worth writing down so it does
  not get re-litigated by whoever reads Google's setup guide next.

My recommendation is the first, with the second as the documented shape if a tag is ever genuinely
needed. What I am not willing to do is leave the question implicit, because the failure is silent and
the data involved is medical.

## Proposed change

1. Add a short section to
   [capability-telemetry-runbook.md](../../engineering/capability-telemetry-runbook.md) — the doc
   AGENTS.md already routes people to before touching bearer-token pages — stating the rule for
   advertising and analytics tags specifically: no third-party tag outside `Observability`, no
   remarketing audience built from any tokened route, offline conversion import preferred over a
   browser pixel.
2. Strengthen the comment in `observability-client.tsx` to name ad pixels explicitly, since it
   currently enumerates the three SDKs that exist and an implementer pattern-matches on that list.
3. Consider whether `check:repo` can cheaply refuse a `googletagmanager.com`, `connect.facebook.net`,
   `snap.licdn.com` or `bat.bing.com` literal anywhere outside `src/app/observability*` — the same
   shape as the existing Intl-cache and clock guards, which exist for exactly this class of
   "regressed twice before it was checked" mistake. If that is more machinery than it deserves at
   zero pixels, say so and leave the runbook rule.

I am specifically **not** proposing removing or loosening the existing redaction, adding a pixel
speculatively, or blocking the advertising decision on this — the assessment's answer is `$0` for
now, and this entry exists so the answer stays safe if it changes.

## Prompt

```text
Read src/app/observability-client.tsx (the comment about CR-001 and the beforeSend wrappers),
src/app/observability.ts (redactCapabilityUrl), docs/engineering/capability-telemetry-runbook.md, and
the "Tactics ruled out" section of docs/product/assessments/paid-acquisition-assessment.md.

DiveDay has bearer-token pages where the URL is the credential (/waivers/[token], /ready/[token],
/recap/[token], /calendar/[token]). Every telemetry SDK is mounted through one Observability
component so redaction cannot be bypassed. Advertising platforms (Google Ads gtag.js, Meta pixel,
LinkedIn Insight, Bing UET) all install as a head script that sends page_location by default, which
would exfiltrate live capability URLs attached to signed waivers and medical evidence.

No pixel exists today and none is planned — the advertising assessment recommends $0 of ad spend for
now. This task is to make the rule explicit before someone follows a platform's setup guide:

1. Add a section to docs/engineering/capability-telemetry-runbook.md covering advertising and
   analytics tags: none outside Observability, wrapped with redaction and with tokened segments
   excluded outright; no remarketing audience may be built from any tokened route; prefer importing
   conversions into an ad platform offline from the existing server-side events in
   src/lib/analytics.ts (demo_entered, trial_started) over a browser pixel.
2. Update the comment in observability-client.tsx so it names ad and conversion tags rather than only
   the three SDKs that happen to exist.
3. Evaluate whether scripts/ should carry a cheap guard refusing googletagmanager.com,
   connect.facebook.net, snap.licdn.com or bat.bing.com literals outside src/app/observability*,
   in the same shape as check-intl-cache.mjs and check-clock.mjs. If you judge that over-engineered
   at zero pixels, write that judgement into the runbook section instead and skip it — do not add a
   check nobody needs.

Done when: pnpm check green, the runbook states the rule in a form someone reading Google's setup
guide would find, and a security-reviewer has confirmed the wording covers remarketing audiences and
not just URL redaction. Delete
docs/product/follow-ups/FU-20260812-ad-pixels-would-bypass-capability-redaction.md as part of the
change.
```
