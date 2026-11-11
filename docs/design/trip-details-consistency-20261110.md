# Departure Details consistency and lifecycle review

## Scope and evidence

The source inventory covers all 110 `page.tsx` routes at `ffb570c8b`. It checks shared page composition, controls, instant navigation and loading siblings. It is not a rendered audit of every route. Staff routes consistently provide instant navigation and sibling loading states. The collection-pattern and visual-pattern audits document intentional differences between operational records, public pages and singleton settings; this change preserves them.

The focused implementation and rendered verification concern departure Details. Conservation belongs in the same labeled-row card as the other departure facts. Its measured post-trip record is different from the departure's definition: staff can record, correct and delete conservation facts after return. Critical values and correction controls use 16px text. The label column is wider; action overflow is based on measured available width rather than a viewport breakpoint. The lower action group names its contents: cancellation/weather for one departure, repeating dates/cancellations for a series.

## Editing by lifecycle

- Before return, the existing role, booking-capacity, hull certificate, roll-call history, meeting-day, course-admission and at-sea cancellation safeguards continue to apply. This pass does not invent additional cutoffs for Boarding, Underway or Heading in.
- Final-day Home closes departure definition, forecasts, participant terms and admission requirements. With no stage, the existing shared return buffer closes them. A current late-running crew word continues to outweigh the clock. An earlier overnight Home does not close a multi-day run.
- The server rechecks the same lifecycle under the trip-row lock. Home taps take that lock too, so a stale open form cannot rewrite a departure after a concurrently completed return.
- The schedule move writer and preview require explicit final Home to close an otherwise unsailed trip, while retaining the stronger existing prohibition once any roll-call evidence exists. The clock alone never strands a postponed unsailed departure. Deletion preserves any crew-stage evidence, including Boarding.
- Conservation, incidents, executed dives, truthful crew corrections, payments and audit history are records of what happened, rather than edits to the plan. Their own authorization and correction rules remain in force. Actual decompression evidence has a separate narrowly scoped correction form after plan closure; it reuses the existing fly-safe correction pipeline and cannot change title, dates, price, capacity or any other plan field. It compares the form’s expected prior safety value under the trip-row lock, so a stale unchecked form cannot clear a newer decompression record; a fresh form can correct either direction. After plan closure the crew row explicitly says “Correct crew record” and contains no boat-definition editor. Both explicit missing-diver corrections and unfinished started after-dive counts remain live.
- Series operations remain scoped to future departures by their existing writers. “Manage future dates” and the repeating-date action group remain reachable from a historical occurrence, even when no future occurrence exists. The old occurrence's cancellation and weather doors close only on explicit final Home.

## Verification observed

The final source passed app and worker typechecks, a production build, 400 affected unit/action tests, 54 functional browser tests, four real-PostgreSQL concurrency tests and all 70 registered static guards. The Home/save race and stale decompression correction both exercise the trip-row lock with actual PostgreSQL transactions. The filled early-Home browser case confirms that plan editing closes while conservation and the separate safety correction remain available.

Light production captures cover the normal Details ledger at 390, 820 and 1280 pixels, and the opened plan/details and returned conservation editors at 390 and 1280. The pixel probe examined 25 records across four capture groups and found no flags. These Mac captures prove local layout and behavior; Linux baseline comparison remains CI evidence. The independent dock review raised and resolved crew correction, clock-only postponed-trip recovery, future-series reachability and stale safety-evidence overwrite before accepting the final source.

## Residual verification

A structural inventory does not establish visual quality on every page. Existing collection and singleton-settings compositions require their own filled-state rendered review before a broader visual consistency claim. Small spacing differences on Settings Dock-day and Features remain unclassified because their singleton-form composition may justify them.
