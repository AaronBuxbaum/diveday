# Findings and implementation briefs

Baseline: `f3bfde4604ea0090eba3143986f01001dbaefab0`. Evidence and source anchors describe the
2026-10-21 audit, not the prepared UX implementation. UX-01–03 retain their dated observations;
their recommendations were removed after [#2873](https://github.com/AaronBuxbaum/diveday/pull/2873)
merged. Delivery is recorded in
[Shipped](../../shipped.md#ux-audit-continuity-and-operational-trust-merged-2026-10-21).

UX-05/07/08 are approved and prepared in groups A/B, not yet merged. UX-04/06/09/10 were unfiled at
the baseline inbox ceiling; their current tracker and implementation state are unknown here. Their
briefs preserve the baseline concern and require final-parent reconciliation before action.

Priorities: P1 affects a core workflow through lost work or misleading selection; P2 causes
incorrect or incomplete contextual behavior; P3 is a smaller trust or polish defect. Effort is a
rough relative estimate, not a delivery commitment.

## UX-01 — Keep search outages distinct from no matches

**Tracker:** [#2857](https://github.com/AaronBuxbaum/diveday/issues/2857).

**P1 · Browser reproduced · effort M**

**Evidence.** palette-hooks.ts:44–65 maps HTTP failures and non-abort exceptions to EMPTY.
CommandPalette.tsx:246–259 offers Add diver for every query of two or more characters. In the local
browser, intercepting /api/search?q=zzunavailable with HTTP 503 left Add diver as the highlighted
action, with no unavailable or retry state.

**User consequence.** A desk worker searching for an existing diver receives an invitation to create
a person when the lookup failed. This encourages a mistaken duplicate workflow and makes a
connectivity problem look like a data problem; this audit did not claim that the server necessarily
accepts a duplicate.

**Resolution.** Merged in [#2873](https://github.com/AaronBuxbaum/diveday/pull/2873) on
2026-10-21. This observation remains historical evidence; the baseline captures do not retest the
fix or establish deployment.

**Source anchors:** [palette-hooks.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/search/palette-hooks.ts), [CommandPalette.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/search/CommandPalette.tsx).

## UX-02 — Prevent Enter from opening a previous search result

**Tracker:** [#2855](https://github.com/AaronBuxbaum/diveday/issues/2855).

**P1 · Browser reproduced · effort M**

**Evidence.** palette-hooks.ts:44–65 leaves prior results in state during the next debounce/request.
CommandPalette.tsx:658–660 activates flat[active] on Enter. A controlled result named Audit First
Person for query first stayed visible after replacing the query with second and holding the new
response; Enter navigated to /divers/audit-first.

**User consequence.** Fast keyboard users can open the wrong person's record. The audit proves wrong
navigation, not an unauthorized read or a downstream wrong-person mutation.

**Resolution.** Merged in [#2873](https://github.com/AaronBuxbaum/diveday/pull/2873) on
2026-10-21. This observation remains historical evidence; the baseline captures do not retest the
fix or establish deployment.

**Source anchors:** [palette-hooks.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/search/palette-hooks.ts), [CommandPalette.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/search/CommandPalette.tsx).

## UX-03 — Save a staff form draft when navigation interrupts typing

**Tracker:** [#2856](https://github.com/AaronBuxbaum/diveday/issues/2856).

**P1 · Browser reproduced with positive control · effort M**

**Evidence.** FormDraft.tsx:88–106 schedules a save 600 ms after focusout and clears the timer on
effect cleanup. The local new-diver form lost UX Audit Interrupted Draft after typing, immediately
clicking the Divers navigation link, and freshly reopening the form. No draft action was sent.
Blurring and waiting for the save preserved UX Audit Saved Draft after reload.

**User consequence.** A normal front-desk interruption loses the just-entered work despite the
documented promise that drafts survive navigation. The three current draft kinds are add_departure,
new_diver and took_a_call; this is not a claim that every form has draft support.

**Resolution.** Merged in [#2873](https://github.com/AaronBuxbaum/diveday/pull/2873) on
2026-10-21. This observation remains historical evidence; the baseline captures do not retest the
fix or establish deployment.

**Source anchors:** [FormDraft.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/FormDraft.tsx), [form-drafts.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/lib/form-drafts.ts), [FormDraft.test.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/FormDraft.test.tsx).

## UX-04 — Recover draft saving after Start over fails

**Reconciliation:** unfiled at the audit snapshot; current tracker and implementation state unknown.
The following brief is baseline evidence, not a verified current recommendation.

**P2 · Source-confirmed failure path; browser failure injection not run · effort S**

**Evidence.** FormDraft.tsx:110–116 sets submitted.current=true, removes the recovery line and
resets the form before awaiting actions.discard. A rejected discard skips the assignment that
restores submitted.current=false. save() returns immediately while that flag remains true. The save
action itself is fire-and-forget at line 82.

**User consequence.** A transient discard failure can clear the visible work and silently disable
subsequent autosaves for that mounted form. A stale server draft can also reappear on a later visit.

**Recommended change.** Treat discarding as a recoverable asynchronous operation. Restore the saving
state in a finally path, preserve or restore the fields if the discard fails, and communicate
failure beside the action. Handle rejected saves deliberately instead of leaving an unhandled
promise as the only signal.

**Acceptance scenarios.** Reject discard, continue typing, blur and verify that a new save occurs.
Verify the failed discard is understandable, retry works, and a successful discard stays discarded.
Test a delayed pre-discard save so it cannot resurrect the removed draft.

**Source anchors:** [FormDraft.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/FormDraft.tsx), [FormDraft.test.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/FormDraft.test.tsx).

## UX-05 — Expose later bookable departures from the diver record

**Tracker:** [#2859](https://github.com/AaronBuxbaum/diveday/issues/2859).

**P2 · Source-confirmed bounded-query behavior · effort M**

**Evidence.** The diver page defines BOOK_ACTIVITY_TRIP_SCAN_LIMIT=50, reads that many upcoming
departures at line 195, then removes already-booked and full trips at lines 203–208. BookActivity
renders the remaining native select or no-open-activities state, without a later-results control.

**User consequence.** If the first 50 departures are full or already booked, the local picker claims
there are no open activities even when departure 51 has room. Other booking routes still exist; this
is an incomplete contextual picker, not a system-wide inability to book.

**Recommended change.** Query available/bookable departures before applying the limit (booking
admission, not the stricter boarding-readiness gate), and provide an explicit date window or a route
to search later availability while carrying the selected diver. Keep the compact day grouping and
preserve server-side seating validation.

**Acceptance scenarios.** Seed 50 full/already-booked departures followed by an eligible one. The
local journey must reveal the later option or clearly state its window and offer a working
continuation. Also test a genuinely empty result.

**Source anchors:** [page.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/shop/[shopSlug]/divers/[personId]/page.tsx), [BookActivity.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/shop/[shopSlug]/divers/[personId]/_components/BookActivity.tsx).

## UX-06 — Order recently collected repairs by collection time

**Reconciliation:** unfiled at the audit snapshot; current tracker and implementation state unknown.
The following brief is baseline evidence, not a verified current recommendation.

**P2 · Source-confirmed ordering defect · effort S**

**Evidence.** workOrderBoard orders rows by receivedAt descending and then takes the first 20
picked_up rows at work-orders.ts:1294–1297. The model already stores pickedUpAt and
setWorkOrderStatus writes it. The board's contract describes the last group as recently collected.

**User consequence.** An old intake completed today can immediately disappear behind 20 newer-intake
repairs that were collected earlier. The owner loses the natural confirmation/history path after
handing the gear back.

**Recommended change.** Select and sort the collected group by pickedUpAt with a deterministic
tie-breaker; keep the open-work ordering appropriate to its separate purpose. Do not change
historical timestamps just to fit the board.

**Acceptance scenarios.** Create at least 21 collected tickets with deliberately different received
and pickup ordering. The most recently picked-up old intake must appear first and remain in the
capped group. Test equal pickup timestamps and tenant scope.

**Source anchors:** [work-orders.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/db/work-orders.ts), [work-orders.test.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/db/work-orders.test.ts), [work-orders.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/db/schema/work-orders.ts).

## UX-07 — Keep course date requests available without a shop contact email

**Tracker:** [#2860](https://github.com/AaronBuxbaum/diveday/issues/2860).

**P2 · Source-confirmed inconsistent capability gate · effort S**

**Evidence.** The course page gates inquiryHref and the entire DateRequestForm on shop.contactEmail
at lines 140 and 227. inquiry.ts persists a request independently; email is only an optional staff
notification. PromotedDateAsk elsewhere renders the same request form without a shop email or phone.

**User consequence.** A shop without a configured email loses course-interest capture, especially
when no session is scheduled, even though the application can save the request for staff. Footer
phone contact may remain, so this is not a claim that all contact is impossible.

**Recommended change.** Gate the form on the ability to accept and retain a request, not the
optional notification address. Pass available contact methods separately and retain abuse limits and
clear staff inbox visibility.

**Acceptance scenarios.** Render a public course for a shop with null contactEmail, submit valid
contact information and verify the request appears for staff without attempting an email nudge.
Cover no-session, scheduled-session, phone-only and normal email-configured shops.

**Source anchors:** [page.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/s/[shopSlug]/courses/[slug]/page.tsx), [inquiry.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/actions/inquiry.ts), [DateRequestForm.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/components/DateRequestForm.tsx).

## UX-08 — Display exact crew tip shares instead of rounded payout amounts

**Tracker:** [#2858](https://github.com/AaronBuxbaum/diveday/issues/2858).

**P2 · Observed in rendered report and traced to source · effort S**

**Evidence.** The rendered demo's October report shows Tips $675 and Equal shares: Keiko Tanaka $338
· Sal Moretti $338. reports/page.tsx:270,337 passes formatReportMoney into tipsSplitLine, which
formats each row.tipsCents at MonthOwnerLines.tsx:45–52. formatReportMoney intentionally sets
maximumFractionDigits:0 at reporting.ts:236–242.

**User consequence.** The displayed distribution adds to $676 while the displayed pool is $675. A
useful payday shortcut becomes untrustworthy. This is a display defect; the audit does not claim
incorrect underlying allocation or payment.

**Recommended change.** Use the exact currency-aware money formatter for individual crew
allocations, retaining whole-unit formatting only where it is truly a summary. Make the displayed
shares reconcile with the exact pool and the exported crew sheet, including remainder allocation.

**Acceptance scenarios.** Test $675 split into two $337.50 shares, odd-cent pools, zero-decimal
currencies and multiple departures with different crew. Compare the visible allocation with the crew
export; do not 'fix' it by changing the ledger to match rounded display.

**Source anchors:** [page.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/shop/[shopSlug]/reports/page.tsx), [MonthOwnerLines.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/shop/[shopSlug]/reports/_components/MonthOwnerLines.tsx), [reporting.ts](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/lib/reporting.ts).

## UX-09 — Avoid claiming that an error report has already arrived

**Reconciliation:** unfiled at the audit snapshot; current tracker and implementation state unknown.
The following brief is baseline evidence, not a verified current recommendation.

**P3 · Source-confirmed unsupported success claim · effort S**

**Evidence.** global-error.tsx:31–32 starts an asynchronous Sentry import/capture, while line 44
immediately says the error has already been reported. There is no confirmed delivery condition and
the import can fail.

**User consequence.** An offline or blocked request can leave a user believing someone has received
the problem when that is unverified. The existing direct support link is valuable and should remain.

**Recommended change.** Use wording that does not claim confirmed delivery, or report a genuinely
known state. Keep retry and direct contact, avoid raw error details, and retain the boundary's
independence from dependencies that may have crashed.

**Acceptance scenarios.** Render with telemetry unavailable and verify the copy makes no
delivered-report promise. The fallback still works when the SDK import rejects and the support route
remains available.

**Source anchors:** [global-error.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/global-error.tsx).

## UX-10 — Use the dock text minimum for report decision amounts and statuses

**Reconciliation:** unfiled at the audit snapshot; current tracker and implementation state unknown.
The following brief is baseline evidence, not a verified current recommendation.

**P3 · Browser computed-style measurement + source · effort S**

**Evidence.** At a 390px viewport, the departure ledger's money amounts (for example $910) and
waiver states (including 3 waivers to collect) compute to 14px. DepartureLedger.tsx:107–120 applies
text-sm to their container. The same page's KPI totals are 30px and other money rows are 16px.
Design principles §2 explicitly includes money amounts and status words in the critical text that
must be at least 16px.

**User consequence.** Facts an owner uses to compare trips or spot outstanding paperwork are harder
to read on a phone than the product's own dock standard permits. This is a measured standards
violation, not a claim of WCAG failure or a measured rate of user errors.

**Recommended change.** Use at least 16px for the decision amounts and waiver states while
preserving the ledger's column alignment, wrapping and quiet-versus-outstanding tone. Keep the
deliberate All waivers in labels; they are not redundant decoration.

**Acceptance scenarios.** Measure computed sizes at 390px and desktop widths. Check long English and
Spanish waiver counts, large currency amounts and zoom without overlap or horizontal loss. Preserve
row navigation and the existing ledger composition.

**Source anchors:** [DepartureLedger.tsx](https://github.com/AaronBuxbaum/diveday/blob/f3bfde4604ea0090eba3143986f01001dbaefab0/src/app/shop/[shopSlug]/reports/_components/DepartureLedger.tsx), [design principles](../../../design/principles.md#2-pass-the-dock-test).
