# 20260907-persona-bots-file-under-a-ceiling — A weekly persona walk may file three issues, and stops entirely at a full inbox

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

`docs/product/personas.md` is a standing frame: fifteen personas, each with a "hold the line on"
list, meant to be re-read before shipping anything that touches their surfaces. Nothing re-reads it
on a schedule. Its own archived predecessor
([the 2026-07-30 review](../../product/archive/ux-personas-20260730-findings.md)) was a human pass
that has not been repeated, and the surfaces it walked have moved a great deal since.

N-61 in [improvement-ideas-20260907.md](../../product/assessments/improvement-ideas-20260907.md)
asks for a weekly agent run that walks each persona's flows against the demo and files
`needs-triage` issues with screenshots. It is marked **Build now**, with one thing flagged as an
owner's call: *issue volume against a one-person inbox*.

That flag is the whole design problem. Fifteen personas over forty-odd surfaces, with an axe scan on
each, can produce a great deal every week. The inbox on the other end is one person, and
`pnpm gates` already ages it because it already rots. A bot that files freely does not add coverage;
it converts a triage queue into a wall, and the first thing that happens to a wall is that nobody
looks at it — including at the entries a human wrote. The failure is not hypothetical enough to
leave to a later tuning pass, because by the time the volume is visible the damage (an inbox
somebody has stopped reading) is already done.

There is a second failure with a shorter fuse. `pnpm check:follow-ups` reads the **live** tracker
inside every pull request's `pnpm check`. A single malformed `needs-triage` issue reddens every open
PR in the repository until somebody fixes it by hand — which happened for real (issue #1097), from
one hand-written issue. A bot filing unattended every Monday is a machine for producing that.

## Decision

Build it, with the volume policy in code rather than in intention, and with the generator
validating its own output against the guard that would otherwise catch it in front of everyone else.

**The walk.** `scripts/persona-bots/walk.spec.ts` opens every surface `personas.md` names, as the
persona who lives on it — anonymously for the diver-facing ones, signed in as the role the persona
holds for the staff ones, and in Spanish for Ingrid, whose findings are invisible in English. It
runs the e2e fleet's own machinery under a config of its own, exactly as
`scripts/simulate-day/` does and for the same reasons. It is weekly and it is not part of any gate.

**Probes are deterministic or they are not probes.** Each one answers yes or no from the rendered
DOM, the response status, or axe's own rule set: the WCAG 2.0 A/AA + 2.2 AA scan
`e2e/a11y.spec.ts` already runs, a skip link, a message key that reached the screen instead of a
sentence, a page that did not render, a browser console error the app itself raised, and a public
page that does not name its shop. The persona doc's softer lines — is the refusal's reason *true*,
is the jargon explained — stay a human's reading. A bot guessing at those would file opinions, and
an opinion is exactly what a full inbox cannot afford.

**A sixth probe was written and withdrawn**, and it is the clearest illustration of where the line
sits. Leo's entry asks that content images reserve their space; an `<img>` with neither
`width`/`height` nor `loading="lazy"` looks like the test for that, and is not. The dry runs found
two shapes that reserve their space perfectly and fail it — `next/image` with `fill`, absolutely
positioned inside a box that already has a size, and a plain `<img>` sized by a Tailwind class —
because whether the layout shifts depends on the *specified* style, which a computed style read
after load cannot recover. It was reporting correct code, weekly. `pnpm check:image-sizes` holds
the neighbouring rule over the source, where the answer is readable.

**The ceiling.** In `scripts/persona-bots/findings.mjs`, and unit-tested:

1. A finding *class* is one issue however many surfaces it fires on. A contrast rule failing on
   eleven pages is one issue naming eleven pages. This is the largest lever by a long way.
2. A class that already has an open issue gets a **comment**, never a second issue — so an aging
   entry carries evidence it is still live rather than only a date.
3. A class whose issue is **closed is never filed again**, ever. Suppressions are printed in the run
   summary, so this is visible rather than silent.
4. **Three new issues per run.** Twelve a month, worst case, and in practice far fewer once (2) and
   (3) start applying. What does not fit is reported and dropped rather than queued: a queue only
   moves the flood a week, and if the finding still matters next Monday the walk finds it again.
5. **Forty open `needs-triage` issues stops the bot filing at all.** Past that the human is already
   behind and the ages `pnpm gates` prints are the thing to read, not another finding. The bot
   yields to the inbox; the inbox never yields to the bot.
6. A run that did not complete files nothing.

**What (5) counts, narrowed.** #1497 asked whether an issue a human has already triaged into a
deliberately-deferred state should still occupy one of the forty. It should not. An issue carrying
`parked` ("read, real, not now") or `waiting-on-external` ("nobody here owes the next move") has
already had the attention the ceiling exists to protect; counting it means ten parked findings
silence the walk permanently while it keeps running every Monday and keeps reporting, accurately and
uselessly, that the inbox is full. So `inboxCount` in `findings.mjs` subtracts them, and the run
summary prints both numbers — counted and open — on every run, braked or not.

Three things this deliberately does not do. **The ceiling did not move**: forty is a number to change
by deciding it is wrong, not by routing around it, and the narrowing is the count's definition rather
than a raise. **`ready-for-agent` still counts**: it is work owed that somebody can clear this week,
unlike the other two. And **the exclusion applies to the count, never to the list** — a parked issue
is still deduplicated against, so a class whose issue is parked gets the ordinary comment. Dropping
it from the list would re-file the finding a human had just parked, which is worse than either answer
the question was choosing between.

The exclusion is only as good as the labels, and that is worth saying plainly: an issue somebody
means to defer but leaves unlabelled still counts. That is correct — the ceiling reads triage state,
and an unlabelled issue has none.

**What this bot publishes, and the invariant that lets it.** A filed issue names every URL the
probe fired on and links a screenshot of it, on a public tracker, from a public artifact. That is
only safe because of a property that is currently invisible in the code: **the walk never opens a
live capability URL.** On every `CAPABILITY_ROUTE_PREFIXES` route (`src/lib/capability-urls.ts`) the
URL *is* the credential, so one capture of a real `/ready/<token>` page — or one issue body quoting
that path — hands whoever reads it a working waiver link. The walk's single bearer-token stop is
`/waivers/not-a-real-token`, which was never valid and is there to see what a dead link looks like.

So there is no redaction layer in this pipeline, and that is a consequence rather than an oversight:
there has never been anything to redact. Adding a stop that mints a real capability changes that, and
`DEAD_CAPABILITY_TOKENS` in `scripts/persona-bots/personas.mjs` plus its test in `findings.test.mjs`
are how the next person meets the rule instead of the incident — a capability-prefixed surface
carrying a token that list does not vouch for fails `pnpm test`. The fix at that point is
`redactCapabilityUrl` before the screenshot and before the issue body, never an exemption.

For the same reason **Playwright's trace is off** (`trace: "off"`) and the workflow uploads only
`persona-bots/`. A trace carries request and response headers, cookies, DOM snapshots and a
screenshot per action, none of which passes through the pipeline that decides what this bot may
publish — it would bypass it entirely, into a public artifact. What it would buy is a picture of the
one thing that can fail a test here, a visit whose tab went away twice, and the run log already
names that surface and its error.

**It files under `needs-triage`, not a label of its own.** A bespoke `persona-bot` label reads
tidier and carries a first-run trap: `gh issue list --label persona-bot` errors while the label does
not exist yet, `listIssuesByLabel` returns `null`, the fail-closed path fires, and the bot silently
files nothing — forever, since the label is only ever created by a successful file. Reusing
`needs-triage` (the `LABEL` constant in `check-follow-ups.mjs`) means the list query works on the
first run, and it puts the bot's findings in the one inbox a human already triages, under the ceiling
above, rather than in a second queue beside it.

**Every body is validated before anything is filed.** `scripts/persona-bots.mjs` imports
`findIssueProblems` from `scripts/check-follow-ups.mjs` — the same function `pnpm check:repo` runs
over the live tracker — and refuses to file a class whose rendered body does not pass, printing why.
`scripts/persona-bots/findings.test.mjs` puts every probe the registry can report through the same
function, and asserts every path the `**Touches:**` line names exists on disk, so the failure is
caught in `pnpm test` rather than in production.

**It fails open, every way it can fail.** No browser, no build, a walk that did not finish, a `gh`
that cannot list the tracker, a body the guard refuses — each prints `DID NOT RUN` or `DID NOT FILE`
with the reason and exits 0. Nothing here is a gate, and a scheduled job that goes red for an
unreachable API trains everyone to ignore the one that goes red for a real finding.

### The judged pass (#1498)

Everything above measures. Almost everything the personas' own lists ask for is a judgement instead
— whether a refusal states a *true* reason, whether the jargon is explained — and the "A model
reading the screenshots" alternative below was refused for exactly that reason. #1498 reverses it,
narrowly: a second pass over the pictures the walk **already took**, off unless a human dispatches
the workflow with it on.

For each of two personas — Nadia (1) and Kai (11), whose lists are almost entirely about words on a
screen — the pass hands a model that persona's own section of `docs/product/personas.md` and the
screenshots of the stops they made, and asks for concrete violations of that list, each naming the
surface and quoting what it read. `scripts/persona-bots/judge.mjs` is the whole of it.

A judged stop is photographed **under the role the persona holds** (`screenshot.mjs --as`), unlike
the path-keyed captures a filed issue links, which stay the owner's view. Kai's entire lens is the
fewest permissions; judging his refusal against a picture of the owner's view of the same URL would
file findings about a page he cannot reach. The prompt says which role each stop was opened under
for the same reason.

Four things make an opinion safe to put in this inbox, and each is code rather than intention:

1. **The fingerprint survives a rewording.** A judgement that varies from run to run cannot be
   deduplicated, and deduplication is what stops a finding being filed every Monday. The probe id is
   `judged:<persona>:<path>:<hash of the normalised claim>` — casing, punctuation, a leading "The"
   and anything past the first twelve words are stripped before hashing. `fingerprint()` wraps it
   like any other probe id, so the open-issue comment path and the closed-issue suppression both
   work unchanged: a judged claim a human has closed is never re-filed.
2. **A judged finding ranks below every measurement.** `judged` is the last band in `IMPACT_RANK`,
   and `classify` sorts by impact first, so the three-issue budget reaches an opinion only once the
   facts have left some. No mechanical probe may declare the band; a test refuses one that does.
3. **Nothing is exempted.** The brake, the comment ceiling, the suppression and the
   `findIssueProblems` self-check apply to a judged body exactly as to a mechanical one — and the
   body says outright that a model wrote it, quotes what it read, and tells the reader that closing
   the issue with "no, and here is why" is a complete answer.
4. **Anything unverifiable is dropped.** A finding naming a surface the persona was not shown is the
   model answering from the doc rather than from a picture; one with no quotation is an opinion with
   nothing behind it. Both are discarded. The pass may report less than it saw, never more.

**Opt-in is the mitigation, not a convenience.** `--judge` is reachable only from
`workflow_dispatch`; the Monday `schedule` does not pass it, and the cron gets it only after a month
of dispatched output somebody has read — the issue's own condition. `ANTHROPIC_API_KEY` is a
repository secret a human adds, the same shape as `GITHUB_TOKEN` in that workflow, not a
`config/env-registry.mjs` row (that registry is the application's own environment). With the flag
off the run is byte-identical to the one before this landed, down to the number of screenshots
taken.

**It sends pictures of the demo shop to a third party**, including a staff schedule board rendering
seeded diver names. The data is synthetic and the shop is never a real one, and the capability
invariant above carries over unchanged — `DEAD_CAPABILITY_TOKENS` keeps live capability URLs out of
the walk, so out of the judged pass too.

## Alternatives considered

- **File freely and tune later.** Rejected in the Context: by the time the volume is visible the
  inbox has already been abandoned, and abandoning it costs the human-written entries too.
- **Reopen a closed issue when the finding returns**, rather than suppressing it permanently. This
  is the more obvious reading of "prefer amending an existing issue over filing a near-duplicate",
  and it is rejected on purpose: a close is a human's judgement, and re-opening it every Monday is
  an argument the bot always wins by attrition. Suppression is strictly more conservative, it is
  reported rather than silent, and reopening is one click for a human who disagrees. The cost is
  real and named: a defect that is genuinely fixed and later regresses is never re-filed. If that
  bites, the fix is to reopen only issues closed as *completed* — not to reopen everything.
- **A queue, so a finding over the ceiling files next week.** Rejected: it defers the flood instead
  of refusing it, and a finding that has stopped reproducing should stop being filed.
- **Let the run fail red when it cannot file.** Rejected: see above.
- **One issue per surface rather than per class.** Rejected: it multiplies volume by the number of
  pages for no extra information — the class *is* the work, and the surfaces are its evidence.
- **A model reading the screenshots and judging them against each persona's prose.** The most
  faithful reading of "persona bots", and out of scope here: it needs a budget, a provider decision
  and an ADR of its own, and it produces exactly the unfalsifiable findings the ceiling exists to
  keep out of the inbox. The deterministic walk is the half that can ship without an owner
  decision, and it is the half whose findings are reproducible by opening a URL. **Reversed for an
  opt-in pass by #1498 — see "The judged pass" above.**

## Consequences

The persona frame gets re-read every week by something that does not get bored, and its findings
arrive with the surface URL, the persona whose line they break, and a screenshot. The tracker gains
at most three bot-written issues a week and often none.

Costs: the walk is another Playwright run to keep working (it uses the fleet's helpers, so it breaks
the way the fleet breaks), and the artifact holding the screenshots expires after 30 days while the
issue does not — mitigated by every filed prompt telling the session to re-capture with
`node scripts/screenshot.mjs <path>`, which is reproducible for as long as the surface exists.

Revisit the numbers — three, five, forty — once there is a month of real runs to look at; they are
constants in one file with tests around them, and moving them is a one-line change plus the reason.
Revisit the suppression rule if a real regression is found to have been silently swallowed by it.

The judged pass costs one API request per persona per dispatched run, six extra screenshots, and a
standing obligation: read a month of its output before letting the Monday cron near it, and turn it
off rather than tune it if what it files is not worth the reading. Forty stopped meaning "forty open"
and started meaning "forty awaiting triage" (#1497), so the brake now depends on labels a human
applies — an issue deferred without its label still counts, which is the correct failure.
