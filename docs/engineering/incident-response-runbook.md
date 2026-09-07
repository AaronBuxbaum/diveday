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

## Prerequisite: where the alerts go

`alerts@dive.day` **exists** (owner, 2026-08-06), set up the same way `aaron@dive.day` and
`legal@dive.day` were — see "DiveDay's own addresses" in
[ses-email-runbook.md](ses-email-runbook.md). Every destination in this runbook and in
[monitoring-runbook.md](monitoring-runbook.md) points at it: Sentry issue alerts, Sentry Cron
Monitor missed check-ins, the uptime monitor below, the app's own new-account alert (`ALERT_EMAIL`
in `src/lib/platform-mail.ts`), and the AWS budget-threshold and cost-anomaly alerts, whose
`alertEmail` default in `infra/lib/infra-stack.ts` §7 is now that address rather than a personal
Gmail. The stack default only takes effect on the next `pnpm infra:deploy`; a stack deployed before
2026-08-06 still carries the old subscription until then, and the SNS email subscription it creates
needs a human to click Confirm in the mailbox either way.

**The external monitor exists as of 2026-09-07** (ADR
[20260907-external-uptime-monitor](../architecture/decisions/20260907-external-uptime-monitor.md)).
Everything above is a path *out of* DiveDay's own infrastructure into a mailbox, and all of it goes
quiet in a total outage — the Vercel project down, DNS wrong, the region gone. A Route 53 health
check does not: it polls `/api/health` from AWS's own checker regions, outside this account, and
alarms into the same topic. See [Uptime monitoring](#uptime-monitoring) below for what it checks and
what is still uncovered.

## Severity ladder

Pick the row that matches the **worst** true statement, not the most comfortable one. When two rows
could apply, take the higher one — over-escalating a Sev-3 costs an hour; under-escalating a Sev-1
costs a shop's day.

| Sev | Means | Examples | Response |
| --- | --- | --- | --- |
| **Sev-1** | Divers or staff cannot do the thing the product exists for, or safety/legal data is wrong or lost | Site down or 500s on the public schedule; booking or checkout fails; the boat manifest or roll call shows wrong people; waiver records lost, corrupted, or a signed waiver won't render; medical flags missing; auth broken so nobody can sign in; capability tokens leaking | Drop everything. Roll back first, diagnose second. Fix forward the same day. Write it up |
| **Sev-2** | A significant workflow is degraded but there is a way through | Emails/SMS not sending; the daily reminder or hourly recap cron tick failed; payments succeed but the order state lags; a staff surface is broken while the diver-facing side works; the schedule builder throws | Fix today. Roll back if the cause is a recent deploy. Tell affected shops if a departure is within 48 hours |
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

**What is wired, and where.** The liveness probe below is a Route 53 health check declared in §22 of
`infra/lib/infra-stack.ts` off the `UPTIME_TARGETS` row in `infra/lib/observability.ts` — `pnpm
infra:deploy` creates it, and there is nothing to set up in a third-party console. It polls every 30
seconds from several AWS regions, matches `"status":"ok"` in the body as well as the 200, and its
CloudWatch alarm reaches `alerts@dive.day` about four minutes after the site goes away. Its alarm is
the one alarm in the stack that treats **missing data as breaching**: a monitor that has gone quiet
is indistinguishable from the outage it watches for.

**What a shop sees.** `https://dive.day/status` runs the same checks in the request that renders it
and says what it found and when. Point a shop at it rather than answering "is it just me" by hand,
and read it yourself before diagnosing: it separates "the app is gone" from "the app is up and the
database is not" in one line.

**Still uncovered:** the second target below. A health check cannot render a page, so nothing yet
catches a 200 that draws an empty shell. That needs a browser canary against a real shop's public
schedule, which needs a pilot shop's slug — see AWS-1 in
[aws-migration-dossier.md](../architecture/aws-migration-dossier.md).

Two targets, deliberately different in kind:

| Target | URL | Checks | Alert on |
| --- | --- | --- | --- |
| Liveness probe | `https://dive.day/api/health` | The deployment is up **and** `select 1` round-trips through the same `getDb()` every request path uses. Answers `503` (not `200` with a flag) when the database check fails, so status-code alerting is enough | Two consecutive non-`200`s |
| Public schedule | A real shop's `https://dive.day/s/<shopSlug>` | A full Server Component render against real data — the page a diver actually lands on. It is public by design (its own namespace, ADR 20260803-public-shop-namespace), so no credential is needed | Two consecutive non-`200`s, or a keyword check failing |

The health probe alone is not enough: it deliberately does almost nothing, so it stays green while a
rendering bug 500s every real page. The schedule alone is not enough either: it cannot distinguish
"the app is down" from "this shop's page is broken". Together they separate those cases in the alert
itself.

The liveness probe needs no setup beyond a deploy. One thing is still worth doing by hand, once:

**Test the alert path deliberately.** In the Route 53 console, open the health check and turn
*Invert health check status* on for a few minutes. The alarm should fire and the mail should land in
`alerts@dive.day`; turn it back off afterwards. An untested alert path is indistinguishable from no
alert path, and this is the only alert in the product whose whole value is that it works on the
worst day.

When the schedule check is built (a browser canary, against a real shop), assert on text the page
itself renders. **Do not** assert on a date or price — those move with the clock and the negotiated
locale, and the check will flap.

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
> We're aware of a problem affecting [bookings / the schedule / waiver signing] that started around [time, with timezone]. [What still works: e.g. "The boat manifest and roll call are unaffected."]
>
> If you have a departure today, [the specific workaround — print the manifest from the offline viewer / take the booking by phone and enter it later].
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
> [What, if anything, they need to do — e.g. "Two bookings made between 09:10 and 09:40 were not recorded and we've re-entered them; please check trip X."] [If nothing: "No action is needed on your side."]
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
| Reminders or recaps didn't send | Reminders: Sentry Cron Monitor `diveday-daily-tick`; recaps: `diveday-recaps`. A **missed** check-in means the respective endpoint was never called (cron entry, `CRON_SECRET`, platform); an **error** check-in means it ran and its scan threw. The recap scan is hourly and logs `cron_recaps.scan_failed`; the daily tick's per-scan Sentry issue carries a `cron_scan` tag naming which |
| A repeating trip stopped putting new dates on the board | Sentry Cron Monitor `diveday-trip-series-roll`: a **missed** check-in means `/api/cron/trip-series` was never called, so every open-ended run's far edge has stopped advancing (it takes ~4 months to become visible to a diver). An **error** check-in means some series could not be rolled — the pass logs `cron_trip_series.roll_complete` with `seriesFailed`, and the usual cause is a run whose every instance was deleted or whose course was archived. Staff can always re-open one from its trip page's "Start repeating again" |
| The demo shop's schedule is empty ("No trips on the books yet" on `/s/blue-mantis`) | Sentry Cron Monitor `diveday-demo-refresh`: a **missed** check-in means `/api/cron/demo-refresh` was never called, so the canonical demo's clock-anchored board has aged out from under its one-time seed — which is what the homepage's "See a diver's booking page" link opens (ADR 20260812-demo-schedule-keeper). An **error** check-in means the restore itself failed; it runs in one transaction, so the demo is intact and the next tick re-attempts it. The pass logs `cron_demo_refresh.pass_complete` with the `runwayDays` it found — re-running the route by hand restores immediately |
| One scan is failing every day but others are fine | By design since the per-scan isolation landed: `runScan` catches, captures to Sentry with the scan name, and lets the rest run. Find the issue tagged with that `cron_scan` value; the tick answers 500 with `failedScans` in the summary log |
| Errors appeared right after a deploy | [deploy-and-migrations-runbook.md](deploy-and-migrations-runbook.md) — most likely a contracting migration, or a build that failed after `pnpm db:migrate` already ran |
| Instant Rollback didn't help | The damage is in data, not code. [backup-and-restore-runbook.md](backup-and-restore-runbook.md) §1 |
| Nothing seems wrong but a shop says it is | Ask which URL and what time, then check that shop's schedule directly. Shop-scoped data problems are invisible from every dashboard in this document |
| Errors are reported but no alert email arrived | The mailbox exists, so this is a wiring problem, not a missing address: check Sentry's alert rule actually names it, then that the SNS email subscription was confirmed (AWS won't send to an unconfirmed one, and it looks identical to a working one in the console until you look at its status). Then the checklist in [monitoring-runbook.md](monitoring-runbook.md) |
