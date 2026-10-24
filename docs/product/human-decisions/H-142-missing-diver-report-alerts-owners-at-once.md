# H-142: Does a filed report of a missing diver tell the owners at once?

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

- **When:** at filing, not at draft. A draft that already says "missing diver" sends nothing; filing is the act that says the crew means it (`fileIncidentReport`, `src/db/incident-reports.ts`). Amended 2026-10-17 below: the roll-call row's own tap also sends, before the report is written.
- **Recipients: the stale alert's, re-read live.** Active owners with a login (`ownerLogins`) and the manifest's followers who are still live staff (`pushTripAlert`). A demoted owner, a disabled login or a follower who left hears nothing.
- **The shore contact is not included.** Their consent and confirmation were given for the stale roll-call alert (H-118), and this is a different message; adding them is a decision of its own.
- **Counts nothing, names nobody.** The mail says "Missing diver on {trip}. Reported {time}. Call the boat first." with the time the incident happened, a link to the report behind the staff sign-in and one to the emergency reference. The push says that a missing diver was reported on this departure. No name, severity or word of what happened: the report is personal and medical data.
- **Told means every owner's email was sent.** A push is an extra and never counts. `incident_reports.missing_alerted_at` is a lease taken by a conditional update (two passes never send at once, ten minutes at most if a pass dies); `missing_alert_sent_at` is written only when every active owner's email was sent. If any owner's email failed, or there was no owner to email, the lease is given back and the next pass sends again, so an owner who already got the mail may get a second copy; a crash cannot lose the alert. Filing sends at once; the hourly crew-notices pass (`:06`) retries any filed report of the last six hours that is not told, and reports its own failure apart from the crew notices and the stale roll-call pass. Filing never fails because a send did.
- **The push goes with the first sends only.** To followers of the manifest, within fifteen minutes of filing and only when the incident was within six hours of the filing; an older incident, or a late retry, is email only, so a long-ago event does not wake a boat.
- **Nobody is left not knowing it failed.** A filed report shows "Owners alerted" with the time, or "Not reached yet. Call them." The crew-notices cron monitor checks in as an error while a filed report stays untold thirty minutes after filing, and a missing public origin is logged as an error.
- **Filing warns.** The File card on a missing-diver draft says "Filing tells the owners now. Is the diver still missing?"
- **Retry cadence stays hourly.** A tighter cron for one kind would wake the database on its own schedule, which `src/lib/cron-schedule.test.ts` keeps all hourly passes from doing; the send at filing is the fast path, and the screen and the monitor cover the rest.
- **Never for a rehearsal, a cancelled departure, a demo shop, a discarded report or any other kind.** The stale alert itself is unchanged.
- **Not a new channel.** Email and the existing manifest push, no SMS.

## Amendment 2026-10-17 (issue #2694, decided by Aaron)

- **"Missing diver, alert owners now"** on a roll-call row marked not back aboard, a diver's or a crew member's, apart from the report. The tap starts the one report for that disappearance (as "Start a missing diver report" does), stamps it raised (`missing_alert_raised_at`, by whom) and sends the alert above at once; the report stays a draft until filed. A double tap, a second crew member's tap and a later filing are the same one alert. Same people as the report button; a raised report is never discarded and stays of kind missing diver (database checks too) (`raiseMissingDiverAlert`).
- **"Found"** on a report that was raised or filed: refused while the roll call still has the person not back aboard, so one wrong tap cannot silence a live disappearance. Any of the departure's crew may tap it, on the report or on the row beside "Mark back aboard". Recorded once with who and when, it stops an alert not yet sent and emails each active owner one quiet all-clear, no push, at most once (`missing_all_clear_claimed_at` is claimed before any send and a failed send is not retried; `missing_all_clear_sent_at` only when every owner was sent, and the report says when it was partial). Found also needs the roll call's latest mark to be "boarded" (a `cleared` undo is not back aboard), sends no all-clear for an alarm that never went (`missing_alert_sent_at` unset), wakes no push once found, and replies with what the all-clear really did. The all-clear counts, naming nobody, anyone else on the departure still reported missing (`markMissingDiverFound`, `sendMissingDiverAllClear`, domain and security reviews 2026-10-17).
- **Never "owners alerted" unless the send reached someone**: otherwise the row says "Not reached yet. Call the owners now.", and a re-tap sends again. The hourly pass skips a raised report once the roll call has the person back, and stops between owners once Found. Marked not aboard again after Found, a raise opens a new report and alerts again. Offline, the button says to phone the owners or use VHF.
- The shore contact as a recipient (option 3 on the issue) waits until a pilot shop asks.

## Amendment 2026-10-24 (issue #2828, after the independent domain and security reviews)

- **Who the alarm reached is written down.** Each owner whose alarm email was sent goes into `incident_reports.missing_alert_reached_person_ids` at once, once per person. A retry pages only the owners not reached yet, so nobody gets a second copy; "told" (`missing_alert_sent_at`) still means every current owner has been reached.
- **The all-clear goes to exactly that set, as far as the shop still lets it reach them**, never the owner list at Found. An owner promoted since never saw the alarm and gets no all-clear. One demoted since, with a login still active, saw it and gets one. A login the shop turned off, or a person it removed or erased, gets nothing: a revoked login is logged as a warning, not counted as a failed send. A partial alarm clears whoever it reached rather than sending nothing; an alarm that reached nobody has no all-clear. The claim reads the set in the same statement, and an alarm sent as the all-clear is claimed sends that owner's all-clear itself, so at most one per owner and none skipped. A failed all-clear send is logged as an error and the report says partial. This replaces "each active owner" and "no all-clear unless `missing_alert_sent_at`" above.
- **Reports already told when this shipped** were filled from the shop's owners with an active login, by migration, so an open alarm still gets its all-clear.
- **Known gap, accepted:** a process that dies between an alarm email being sent and its owner being written down leaves that owner out of the set. The retry pages them again and writes them down; if the diver is found first, that owner gets no all-clear.

## Minimum outcome to record

Whether a stated missing diver skips the stale roll-call window, who is told, and by which channels.

## Unblocks / follow-up

Nothing waits on it. Open, for whoever asks: the shore contact as a recipient (needs its own consent wording), managers, and a severity threshold (option b).
