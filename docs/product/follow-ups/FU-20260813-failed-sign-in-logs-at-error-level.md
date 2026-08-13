# FU-20260813-failed-sign-in-logs-at-error-level — Stop an ordinary wrong password from writing an `error` log line

- **Status:** Open
- **Raised:** 2026-08-13 — issue #517, the production log triage that fixed the SES sender (PR for `fix/ses-sender-quoting-issue-517`)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/lib/auth.ts`, `src/lib/auth.config.ts`, `infra/lib/observability.ts`

## What I noticed

Issue #517 was a dump of ten production log lines filtered to `level:error,fatal,warn`. One of them
is this, from a sign-in attempt on `/s/blue-mantis`:

```
[auth][error] CredentialsSignin: Read more at https://errors.authjs.dev#credentialssignin
```

`CredentialsSignin` is what Auth.js throws when a password does not match. It is the single most
ordinary thing that happens on a sign-in form, and it is being written to the logs at `error` level
with an ANSI-coloured prefix. A shop owner mistyping their password is not an error condition, but
it is indistinguishable at a glance from one that is.

The cost is not the line itself, it is what the line does to the search that finds real problems.
The triage in #517 started from `level:error,fatal,warn` over 24 hours and got ten results, of which
this was one — a 10% false-positive rate on the query an operator runs when something is wrong. It
also means the count of `error` lines can never be alarmed on, because its floor is "however many
people fumbled a password today."

## Why it isn't already done

Outside the scope I was given. #517 asked for the errors to be resolved and three of the four
distinct causes were real defects with real fixes (the SES sender quoting, the pg concurrent-query
deprecation, the blind `cron_demo_refresh.pass_failed` payload). This one is not a defect — the code
is behaving correctly and Auth.js is logging it exactly as designed. Changing it means taking a
position on what DiveDay considers an error, which is a judgement about the observability contract
rather than a bug fix, and it touches the auth module, where `AGENTS.md` requires a
`security-reviewer` pass before merge. Bundling that review into a log-triage PR would have been the
wrong trade.

There is also a real argument for the current behaviour that a human should weigh: a burst of failed
sign-ins is a credential-stuffing signal, and the thing that makes it visible today is precisely that
each one is loud. Any change here must keep that visible — quieter per-attempt, not blind.

## Proposed change

Configure Auth.js's `logger.error` in `src/lib/auth.ts` so a `CredentialsSignin` cause is written
through `src/lib/log.ts` at `warn` with a structured event (`auth.sign_in_refused`) instead of
reaching the default console logger at `error`. Every other Auth.js error keeps its current level —
this is a single known-cause downgrade, not a blanket silencing.

Then add the counted signal that replaces what the loud line was accidentally providing: a metric
filter on `auth.sign_in_refused` in `infra/lib/observability.ts`, alarmed on *rate* rather than
presence, so credential stuffing is more visible than it is today rather than less. That is the part
that makes this an improvement instead of a mute button.

Do **not** simply drop the line, and do not filter it at the CloudWatch end — the failure has to stay
countable, and a filter in the log pipeline leaves the noisy line in Vercel's own log view where the
#517 triage was actually done.

## Prompt

```text
In the DiveDay repo, stop ordinary failed sign-ins from writing `level:error` log lines, without
losing the ability to see credential stuffing.

Read first: src/lib/auth.ts and src/lib/auth.config.ts (how Auth.js is configured), src/lib/log.ts
(the structured logger and its levels), and infra/lib/observability.ts (the registry of counted
signals and alarms — read the header comment; signals are declared there, never at a call site).

The constraint that makes this non-obvious: a failed sign-in is both noise and signal. One person
mistyping a password should not be an error, but a burst of them is a credential-stuffing attack and
must get *more* visible, not less. So this is a downgrade plus a counted metric, never a deletion.

Do this:
  1. Give the Auth.js config a `logger.error` that recognises the `CredentialsSignin` cause and
     routes it through `log()` as `auth.sign_in_refused` at "warn". Every other error keeps its
     current level and destination. Log no email address, password, or IP — AGENTS.md forbids PII in
     logs (see how src/lib/notifications/ses.ts masks addresses before logging them).
  2. Register `auth.sign_in_refused` as a counted signal in infra/lib/observability.ts with an alarm
     on rate, not on presence. Follow the shape of the signals already there.
  3. Tests: a unit test that a CredentialsSignin cause produces one warn-level `auth.sign_in_refused`
     line carrying no address, and that an unrelated Auth.js error still logs at error. The infra
     test suite snapshots the stack — run `pnpm test infra -u` and review the diff rather than
     accepting it blindly.

AGENTS.md requires a security-reviewer review for auth changes; say so in the PR description.

Done when: a wrong password produces one warn line and no error line, an unrelated auth failure
still produces an error line, the new signal is counted and alarmed, and `pnpm check` is green.

Delete docs/product/follow-ups/FU-20260813-failed-sign-in-logs-at-error-level.md as part of the change.
```
