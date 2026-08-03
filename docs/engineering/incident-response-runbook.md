# Incident response runbook

What to do when production is broken. DiveDay runs on one Vercel project and one Neon Postgres
project ([H-04](../product/human-decisions.md)), with error capture in Sentry
([ADR 20260727-sentry-error-monitoring-q7fk2p](../architecture/decisions/20260727-sentry-error-monitoring-q7fk2p.md)),
an unauthenticated liveness probe at `src/app/api/health/route.ts`, and a Sentry Cron Monitor
check-in inside `src/app/api/cron/reminders/route.ts`. H-04 names **Aaron Buxbaum** as the owner of
secrets, backups, domain, and incident response, and explicitly leaves "the incident-response
runbook" as still to be written down. This is that document.

There is one operator. Everything here is written to be followed alone, at speed, without
consulting anyone.

## Prerequisite: the alert address does not exist yet

> `TODO(owner)` — **Create `alerts@dive.day` as a hosted mailbox (or forwarding group).** Every
> destination in this runbook and in [monitoring-runbook.md](monitoring-runbook.md) points at it —
> Sentry issue alerts, Sentry Cron Monitor missed check-ins, the uptime monitor below, and the app's
> own new-account alert (`ALERT_EMAIL` in `src/lib/platform-mail.ts` already targets it). Set it up
> the same way `aaron@dive.day` and `legal@dive.day` were — see "DiveDay's own addresses" in
> [ses-email-runbook.md](ses-email-runbook.md). Until it exists, **every alert in this
> document goes nowhere.**

> `TODO(owner)` — **Repoint the AWS cost alerts too.** `infra/lib/infra-stack.ts` §7 defaults
> `alertEmail` to a personal Gmail address, so budget-threshold and cost-anomaly alerts land in a
> personal inbox rather than the operational one. Once `alerts@dive.day` exists, either redeploy with
> `--context alertEmail=alerts@dive.day` or change the default in the stack. Noted here because it is
> the same class of drift this runbook is trying to prevent: alerts nobody has confirmed a human
> actually receives.

## Severity ladder

Pick the row that matches the **worst** true statement, not the most comfortable one. When two rows
could apply, take the higher one — over-escalating a Sev-3 costs an hour; under-escalating a Sev-1
costs a shop's day.

| Sev | Means | Examples | Response |
| --- | --- | --- | --- |
| **Sev-1** | Divers or staff cannot do the thing the product exists for, or safety/legal data is wrong or lost | Site down or 500s on the public schedule; booking or checkout fails; the boat manifest or roll call shows wrong people; waiver records lost, corrupted, or a signed waiver won't render; medical flags missing; auth broken so nobody can sign in; capability tokens leaking | Drop everything. Roll back first, diagnose second. Fix forward the same day. Write it up |
| **Sev-2** | A significant workflow is degraded but there is a way through | Emails/SMS not sending; the daily cron tick failed so reminders and recaps didn't go out; payments succeed but the order state lags; a staff surface is broken while the diver-facing side works; the schedule builder throws | Fix today. Roll back if the cause is a recent deploy. Tell affected shops if a departure is within 48 hours |
| **Sev-3** | Wrong, ugly, or slow, but nothing is blocked | A single page renders badly; a stale copy string; a slow-but-working query; a failing non-blocking background job | Normal work. Ticket it, fix in the next PR |

Two overrides that jump straight to Sev-1 regardless of blast radius:

- **Anything touching a manifest, roll call, cert gating, or medical flags** — these are the
  safety-critical surfaces in `AGENTS.md`. A manifest listing the wrong divers is Sev-1 even if only
  one trip is affected.
- **Any suspected exposure of a bearer capability token** — see
  [capability-telemetry-runbook.md](capability-telemetry-runbook.md) for rotation, and treat the
  exposure itself as the incident.

## First five minutes

Do these in order. Steps 1 and 2 are the ones people skip and regret.

1. **Write down the time and what you observed**, verbatim, before touching anything. A scratch file
   is fine. You will need this for the write-up and you will not remember it accurately in an hour.
2. **Check the health probe.** `curl -i https://dive.day/api/health` — it answers
   `{"status":"ok","commit":"<short sha>"}` with `200`, or `503` when the database check fails. The
   `commit` field tells you which build is actually live, which is the fastest way to know whether a
   rollback has landed or whether the bad deploy is still serving.
3. **Set severity** from the ladder above, out loud, and commit to it.
4. **Check whether a deploy just happened.** Vercel dashboard → the project → **Deployments**. If the
   most recent production deployment landed within the incident window, treat it as the cause until
   proven otherwise. It usually is.
5. **If a deploy is implicated: roll back now.** Don't diagnose first. See below.
6. **Check Sentry** for the issue and its first-seen timestamp — first-seen against deploy time is
   the single most useful correlation available.

## Vercel instant rollback

The fastest lever available, and the correct first move for any Sev-1 that followed a deploy.

1. Vercel dashboard → the project → **Deployments**.
2. Find the last deployment that was healthy — the one before the suspected bad build. Confirm it by
   its commit SHA, not by position in the list.
3. **⋯ → Instant Rollback** (also offered as "Promote to Production"). Confirm.
4. Verify: `curl -s https://dive.day/api/health` and check `commit` now matches the deployment you
   rolled back to. Then load the public schedule and one staff page for real.

**What rollback does and does not do:**

| Does | Does not |
| --- | --- |
| Repoint the production alias at an already-built deployment, in seconds | Rebuild anything |
| Restore the previous application code | **Run any migration, forward or backward** — the schema stays exactly where the bad deploy left it |
| Take effect for new requests immediately | Revert environment-variable changes — those are a separate, manual undo |
| — | Undo any data the bad code already wrote |

That second row is why the expand/contract rule in
[deploy-and-migrations-runbook.md](deploy-and-migrations-runbook.md) is not optional: rollback only
works as a recovery mechanism if the old code can still run against the new schema. **If rollback
does not fix it, the damage is in the database, not the code** — go to the next section.

## Neon restore

When the problem is data — a destructive migration, a bad bulk `UPDATE`, deleted rows — code
rollback cannot help. Neon restores by branching from a timestamp; the live database is untouched
until you deliberately repoint at the branch.

The full procedure, including how to pick the target instant, how to verify before cutting over, and
what has to be reconciled afterward, is
[backup-and-restore-runbook.md](backup-and-restore-runbook.md) §1. Read it there rather than
improvising from memory; the verification step is the one that matters and it is easy to skip.

Two things to know before you start:

- **The PITR window is currently unrecorded** — it is a `TODO(owner)` at the top of that runbook. If
  the incident is older than whatever Neon's window turns out to be, the fallback is the export
  bundles in S3, which do not contain credentials and may be missing photos. Know that before you
  promise a restore.
- **Prefer a partial restore.** Pulling specific rows across from a restore branch costs no
  reconciliation. Cutting the whole database over means everything written since the branch point is
  stranded on the old branch and has to be re-entered by hand.

## Uptime monitoring

Sentry reports errors the app *notices*. It cannot report the app being unreachable, the deployment
never booting, or DNS failing — the app is not running to report anything. That gap is what an
external uptime monitor covers, and it is the one monitoring layer that watches from outside.

Two targets, deliberately different in kind:

| Target | URL | Checks | Alert on |
| --- | --- | --- | --- |
| Liveness probe | `https://dive.day/api/health` | The deployment is up **and** `select 1` round-trips through the same `getDb()` every request path uses. Answers `503` (not `200` with a flag) when the database check fails, so status-code alerting is enough | Two consecutive non-`200`s |
| Public schedule | A real shop's `https://dive.day/s/<shopSlug>` | A full Server Component render against real data — the page a diver actually lands on. It is public by design (its own namespace, ADR 20260803-public-shop-namespace), so no credential is needed | Two consecutive non-`200`s, or a keyword check failing |

The health probe alone is not enough: it deliberately does almost nothing, so it stays green while a
rendering bug 500s every real page. The schedule alone is not enough either: it cannot distinguish
"the app is down" from "this shop's page is broken". Together they separate those cases in the alert
itself.

Setup (any of UptimeRobot, Better Stack, or Vercel's own monitoring works; the free tiers are
sufficient at this scale):

1. Create both checks above at a **5-minute** interval, HTTP GET, 10-second timeout.
2. Require **two consecutive failures** before alerting. A single failed poll is noise; the second
   is signal.
3. Send alerts to `alerts@dive.day` (the `TODO(owner)` at the top of this file — until it exists,
   use a real inbox you actually read, and fix it afterward).
4. On the schedule check, add a keyword assertion on text you expect the page to contain, so a
   `200` that renders an empty shell still fails. **Do not** assert on a date or price — those move
   with the clock and the negotiated locale, and the check will flap.
5. **Test the alert path once, deliberately**, by pausing the check or pointing it at a URL you know
   404s. An untested alert path is indistinguishable from no alert path.

The third external signal is already wired: the Sentry Cron Monitor check-in in
`src/app/api/cron/reminders/route.ts` (`diveday-daily-tick`, overridable via
`SENTRY_CRON_MONITOR_SLUG`). It reports `in_progress` after the auth gate, then `ok` or `error` at
the end, and Sentry raises a **missed check-in** if nothing arrives within the configured margin of
`0 14 * * *`. That is the only signal that fires when the endpoint is never invoked at all — a
deleted cron entry, a rotated `CRON_SECRET`, a platform outage. Point that monitor's alerts at
`alerts@dive.day` too.

## Comms template

Notify affected shops for any Sev-1, and for a Sev-2 where a departure falls within 48 hours. Send
from a real person, not a no-reply. Three short messages beat one long one written late.

**Initial (within 30 minutes of confirming a Sev-1):**

> Subject: DiveDay incident — [what's affected], [status]
>
> We're aware of a problem affecting [bookings / the schedule / waiver signing] that started around
> [time, with timezone]. [What still works: e.g. "The boat manifest and roll call are unaffected."]
>
> If you have a departure today, [the specific workaround — print the manifest from the offline
> viewer / take the booking by phone and enter it later].
>
> We're working on it now and will update by [a specific time, not "shortly"].
>
> — [name]

**Update (at the time you promised, whether or not there is news):**

> Subject: DiveDay incident — update
>
> [What we found / what we've done since the last note.] [Current status.]
>
> Next update by [specific time].

**Resolved:**

> Subject: DiveDay incident — resolved
>
> [What was affected] was restored at [time]. The cause was [one plain sentence, no jargon, no blame].
>
> [What, if anything, they need to do — e.g. "Two bookings made between 09:10 and 09:40 were not
> recorded and we've re-entered them; please check trip X."] [If nothing: "No action is needed on
> your side."]
>
> [What we changed so it doesn't recur.]
>
> — [name]

Rules that matter more than the wording: name what still works, give a workaround before an
explanation, commit to a specific next-update time and hit it, and never say "no data was affected"
until you have actually checked.

## After: the write-up

Every Sev-1 and every Sev-2 that reached a shop gets one, same day, in
[docs/product/human-decisions.md](../product/human-decisions.md)'s decision log if it changed a
decision, or as a dated note in the relevant runbook if it changed a procedure. Five things:
timeline with timestamps, what broke, how it was found (and how long that took — detection latency
is usually the real finding), what fixed it, and the one change that would have prevented it. Then
make that change, or write down why not.

If a runbook was wrong or missing a step, **fix it in the same session**. A runbook that let you
down once will let you down again.

## What this runbook does not cover

- **No on-call rotation, no paging, no escalation path.** One operator, email alerts, best effort.
  An incident that starts at 2am is found at breakfast. That is the honest current posture, not an
  oversight to be papered over with process.
- **No status page.** Comms are direct email to affected shops.
- **No measured RTO or RPO.** Nobody has timed a restore. The quarterly restore test in
  [backup-and-restore-runbook.md](backup-and-restore-runbook.md) §4 is what will produce the first
  real numbers, and it has never been run.
- **Security incidents get only partial coverage here.** Capability-token exposure is handled in
  [capability-telemetry-runbook.md](capability-telemetry-runbook.md); a suspected breach of accounts,
  medical data, or Stripe credentials needs a disclosure decision that is a legal question
  ([H-02](../product/human-decisions.md)), not an engineering one, and that path is not written down
  yet.
- **Third-party outages (Vercel, Neon, Stripe, AWS SES, Twilio) have no documented degradation
  playbook.** Check the provider's status page first; the app degrades to `not_configured` for
  notifications, but there is no rehearsed response for a Stripe or Neon outage.

## When you're not sure what's happening

| Symptom | Look at |
| --- | --- |
| Site unreachable, no Sentry issues at all | The app isn't running to report anything. Vercel dashboard → deployment status; then DNS; then Vercel's status page. This is exactly the gap the uptime monitor covers |
| `/api/health` returns 503 | The `select 1` failed. Neon console → project status and connection count; then whether `DATABASE_URL` was changed recently. `log("health.db_unavailable")` in the Vercel logs confirms it reached the handler |
| `/api/health` is 200 but real pages 500 | Not an infrastructure problem — a rendering or query bug. Sentry issue + `commit` from the health response tells you which build introduced it |
| Health `commit` doesn't match what you deployed | The rollback hasn't propagated, or you rolled back to the wrong build. Re-check the deployment list against SHAs |
| Reminders and recaps didn't send | Sentry Cron Monitor `diveday-daily-tick`: a **missed** check-in means the endpoint was never called (cron entry, `CRON_SECRET`, platform); an **error** check-in means it ran and one or more scans threw — the per-scan Sentry issue carries a `cron_scan` tag naming which |
| One scan is failing every day but others are fine | By design since the per-scan isolation landed: `runScan` catches, captures to Sentry with the scan name, and lets the rest run. Find the issue tagged with that `cron_scan` value; the tick answers 500 with `failedScans` in the summary log |
| Errors appeared right after a deploy | [deploy-and-migrations-runbook.md](deploy-and-migrations-runbook.md) — most likely a contracting migration, or a build that failed after `pnpm db:migrate` already ran |
| Instant Rollback didn't help | The damage is in data, not code. [backup-and-restore-runbook.md](backup-and-restore-runbook.md) §1 |
| Nothing seems wrong but a shop says it is | Ask which URL and what time, then check that shop's schedule directly. Shop-scoped data problems are invisible from every dashboard in this document |
| Errors are reported but no alert email arrived | `alerts@dive.day` almost certainly doesn't exist yet — the `TODO(owner)` at the top. Then the checklist in [monitoring-runbook.md](monitoring-runbook.md) |
