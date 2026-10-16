# H-126: Does a filed report of a missing diver tell the owners at once?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**When someone files an incident report of kind "missing diver", do the owners hear at once, or only when the after-dive roll call has stayed open past the stale window (H-118)?** A person on the boat who files "missing diver" has told the shop the most urgent thing it can hear, and the stale alert waits for a clock that can run an hour or more past it. Issue #2598 asked; whether a stated missing diver skips the stale window is a dive-safety and policy call, because it changes who is woken, when, and by what channel, and an over-eager page trains owners to ignore the channel.

## Options

- **(a) Yes, at once, the same recipients as H-118.** The sender chose "missing diver" on purpose and one email is cheap. Recommended.
- **(b) Yes, but only above a severity threshold.** Fewer pages; a report of a missing diver filed as "minor" would wait.
- **(c) No.** Keep the stale window.

## Decision

**Decided 2026-10-16 (Product owner: Aaron Buxbaum, on issue #2598, taking the recommended option from the ready-for-human decision report): (a).** A filed incident of kind "missing diver" notifies the owners at once: an email to each active owner, and a push to every device following the departure's manifest, once per report.

What the build took from the answer, each a one-line change if Aaron wants another:

- **When:** at filing, not at draft. A draft that already says "missing diver" sends nothing; filing is the act that says the crew means it (`fileIncidentReport`, `src/db/incident-reports.ts`).
- **Recipients: the stale alert's, re-read live.** Active owners with a login (`ownerLogins`) and the manifest's followers who are still live staff (`pushTripAlert`). A demoted owner, a disabled login or a follower who left hears nothing.
- **The shore contact is not included.** Their consent and confirmation were given for the stale roll-call alert (H-118), and this is a different message; adding them is a decision of its own.
- **Counts nothing, names nobody.** The mail and the push say that a missing diver was reported on this departure, and when, with a link to the report behind the staff sign-in. No name, severity or word of what happened: the report is personal and medical data.
- **Once per report, claim released on failure.** `incident_reports.missing_alerted_at` is claimed by a conditional update, so two passes cannot both send. A send that reached nobody, or threw, gives the claim back. Filing sends at once; the hourly crew-notices pass (`:06`) retries any filed report of the last 24 hours whose claim is free, and reports its own failure apart from the crew notices and the stale roll-call pass. Filing never fails because a send did.
- **Never for a rehearsal, a demo shop, a discarded report or any other kind.** The stale alert itself is unchanged.
- **Not a new channel.** Email and the existing manifest push, no SMS.

## Minimum outcome to record

Whether a stated missing diver skips the stale roll-call window, who is told, and by which channels.

## Unblocks / follow-up

Nothing waits on it. Open, for whoever asks: the shore contact as a recipient (needs its own consent wording), managers, and a severity threshold (option b).
