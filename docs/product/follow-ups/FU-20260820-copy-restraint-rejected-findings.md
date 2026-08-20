# FU-20260820-copy-restraint-rejected-findings — Decide the 160 copy trims the sweep proposed and the verifiers refused

- **Status:** Open
- **Raised:** 2026-08-20 — the app-wide copy-restraint sweep on the `ux-refinements` branch
- **Kind:** question
- **Effort:** M
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `.claude/skills/copy-restraint/SKILL.md`

## What I noticed

The sweep that produced this branch read every key in every message bundle against the
[copy-restraint](../../../.claude/skills/copy-restraint/SKILL.md) filter and produced **391
candidates**. An adversarial verify pass — one agent per candidate, told to refuse unless it could
name every render site and rule out each refusal condition — confirmed 227 and refused 164. This
branch applies the confirmed ones (and overrides four of them by hand, recorded in the commit).

The **164 refusals are not all wrong**. A verifier refused when it could not prove safety, which
includes cases where the sentence genuinely earns its place *and* cases where it merely could not
tell — a key reached through a dynamic map, a string an e2e spec asserts verbatim, a surface it
judged safety-adjacent. Nobody has read the refusals as a set to see which are the second kind.

Concretely: `ready.emergencyContactBody`, `ready.certSaved`, `booking.errors.pay`,
`ready.fitUnavailable`, `ready.waiverUnavailable` and `ready.paymentUnavailable` were all refused,
and four of those six are the "We couldn't … just now" apologetic shape the filter names outright.
The refusals were about *how* the trim was worded, not about whether the apology should go.

## Why it isn't already done

Scope, and a real risk of over-trimming. Applying 227 changes to two locales in one branch is
already the largest copy change this repo has had; taking a second pass at the 164 the machine
refused would mean overruling an adversarial verdict one at a time, on judgement, with no cheap
way to check the result beyond reading each surface. That is a sitting-down-with-the-app job, not
a sweep, and it wants the person whose voice the product speaks in.

## Proposed change

Read the refusal set as prose rather than as findings, in one sitting, and split it three ways:
sentences that earn their place (close), sentences the verifier could not prove but a human can
(apply), and sentences that need a rewrite rather than a trim (queue). The `/ready` and `/booking`
error family is the highest-value cluster: six strings, all on a diver's own screen, all
apologising.

Do **not** re-run the sweep expecting different answers — it is deterministic in shape, and the
refusals are the interesting half precisely because a machine could not settle them.

## Prompt

```text
Read .claude/skills/copy-restraint/SKILL.md and docs/design/principles.md (principle 4) first.

The 2026-08-20 copy sweep proposed 391 copy trims across src/i18n/locales/**; 227 were applied on
the ux-refinements branch and 164 were refused by an adversarial verify pass. Many refusals were
"could not prove safe", not "this sentence is good".

Start with the apologetic cluster, which the filter names explicitly and which all render on a
diver's own screen:
  diver.json: ready.fitUnavailable, ready.waiverUnavailable, ready.paymentUnavailable,
              booking.errors.pay, account.onboard.errors.createFailed
Read each one's render site, then rewrite it to state what happened and the next move, with no
"We couldn't", no "just now", no "Please". Keep every actionable clause. Then do the same for
ready.emergencyContactBody and ready.certSaved, which were refused on wording rather than on
substance.

Every key you touch changes in BOTH src/i18n/locales/en-US/diver.json and
src/i18n/locales/es-ES/diver.json in the same change (read src/i18n/locales/es-ES/README.md for
register) or pnpm check:locale fails.

Done when: pnpm check is green, pnpm e2e e2e/ready.spec.ts e2e/booking.spec.ts --reporter=line
passes, and you have looked at /ready and the public booking page in light and dark
(node scripts/screenshot.mjs, see the verify skill). Delete
docs/product/follow-ups/FU-20260820-copy-restraint-rejected-findings.md as part of the change.
```
