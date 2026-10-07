# H-02: What evidence-retention period, deletion-request process, and backup/audit exception apply to waivers and medical flags?

- **Status:** Ready
- **Human owner:** Product owner + generalist attorney (drafts) + scuba-liability specialist (confirms) — Tier 2, see [legal-engagement-scope.md](../stakeholders/legal-engagement-scope.md#tier-2--generalist-drafts-specialist-blesses-before-it-goes-live)

## Decision or approval needed

What evidence-retention period, deletion-request process, and backup/audit exception apply to waivers and medical flags?

## Minimum outcome to record

Retention duration, deletion workflow, permitted staff access, and any legal hold or audit exception.

## Unblocks / follow-up

**Working default recorded 2026-07-30 (Aaron Buxbaum): retain waiver/medical records indefinitely for now**, noted here for review once counsel is engaged — not a final retention policy. Row stays **Ready**: the attorney draft + specialist confirmation (deletion-request process, permitted staff access, legal hold/audit exception) are still outstanding, and indefinite retention of medical data may itself need revisiting once that review happens. **Extended to contacts 2026-08-14 (Aaron Buxbaum):** the same posture covers people who never became divers — someone who submitted a course inquiry or joined a wait list and never booked. DiveDay retains customer and contact data indefinitely and deletes it only when explicitly told to; there is no dormancy clock and none is to be added. A proposal to expire never-booked contact rows on a timer was declined, because a lead who books eight months later is ordinary dive-shop behaviour and the erasure path that matters is the requested one (`src/db/anonymize.ts`). `RETENTION_DAYS` accordingly prunes append-only trails only, never a table holding a person — stated in `src/lib/retention.ts` so the next reader does not re-propose it. **Now stated publicly, 2026-08-14:** `/privacy` describes this posture to buyers in both locales — the append-only windows as real numbers, and waivers/medical answers as kept until the shop removes them, **with the retention period named as still being decided rather than given a figure**. That is deliberate: publishing a number here would pre-empt this row in public, which is worse than the silence it replaced. The page is written to be corrected by this row's outcome, not to substitute for it, and it is **not linked from the footer or /onboard** until this row and H-18 close (FU-20260812-no-privacy-or-terms-page). **Extended to the stage trail 2026-09-10 (Aaron Buxbaum): `trip_stage_events` stays unbounded**, a deliberate exception recorded beside `gear_service_events` rather than a table nobody classified. Two reasons: a row carries no diver data — a shop, a trip, a stage code, a dive-site id, the staff person who tapped it, an instant — so erasure is already answered by the live join to `people` without a window; and the trail is potentially evidentiary, because "when did the crew say this boat was heading in?" is a question an incident review asks a year later, and any window short enough to matter for growth deletes exactly those rows. The 30-day window matching `trip_desk_events` was declined (issue #1397). It is written down in `src/lib/retention.ts`, where the exceptions live; `RETENTION_DAYS` is unchanged. Production data lifecycle, access controls, and deletion tooling.

Part of the [human decision log](README.md#decision-register).
